import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Account code from the legal-name initials + a sequence, if not supplied. */
  private async nextAccountCode(legalName: string): Promise<string> {
    const initials = legalName
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4) || 'CL';
    const count = await this.prisma.b2bClient.count();
    return `${initials}${String(count + 1).padStart(3, '0')}`;
  }

  async create(dto: CreateClientDto) {
    const accountCode = dto.accountCode ?? (await this.nextAccountCode(dto.legalName));
    try {
      return await this.prisma.b2bClient.create({
        data: {
          legalName: dto.legalName,
          accountCode,
          gstin: dto.gstin,
          pan: dto.pan,
          addressLine: dto.addressLine,
          city: dto.city,
          pincode: dto.pincode,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          contactEmail: dto.contactEmail,
          creditLimit: new Prisma.Decimal(dto.creditLimit ?? 0),
          creditDays: dto.creditDays ?? 30,
          isOneTime: dto.isOneTime ?? false,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Account code ${accountCode} already exists`);
      }
      throw e;
    }
  }

  list() {
    return this.prisma.b2bClient.findMany({ orderBy: { legalName: 'asc' } });
  }

  async get(id: number) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(id) } });
    if (!c) throw new NotFoundException('Client not found');
    return c;
  }

  async update(id: number, dto: UpdateClientDto) {
    await this.get(id);
    return this.prisma.b2bClient.update({
      where: { id: BigInt(id) },
      data: {
        ...dto,
        creditLimit: dto.creditLimit != null ? new Prisma.Decimal(dto.creditLimit) : undefined,
      },
    });
  }
}
