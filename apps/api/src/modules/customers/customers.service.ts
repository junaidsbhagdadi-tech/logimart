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
          addressLine2: dto.addressLine2,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
          contactName: dto.contactName,
          contactPerson: dto.contactPerson,
          contactPhone: dto.contactPhone,
          contactEmail: dto.contactEmail,
          tel1: dto.tel1,
          tel2: dto.tel2,
          fax: dto.fax,
          billingState: dto.billingState,
          serviceCentre: dto.serviceCentre,
          origin: dto.origin,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          aadhaarNo: dto.aadhaarNo,
          dobAadhaar: dto.dobAadhaar ? new Date(dto.dobAadhaar) : undefined,
          passportNo: dto.passportNo,
          tanNo: dto.tanNo,
          invoiceFormat: dto.invoiceFormat,
          customerType: dto.customerType ?? undefined,
          registerType: dto.registerType ?? undefined,
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
    const { startDate, dobAadhaar, creditLimit, ...rest } = dto;
    return this.prisma.b2bClient.update({
      where: { id: BigInt(id) },
      data: {
        ...rest,
        startDate: startDate ? new Date(startDate) : undefined,
        dobAadhaar: dobAadhaar ? new Date(dobAadhaar) : undefined,
        creditLimit: creditLimit != null ? new Prisma.Decimal(creditLimit) : undefined,
      },
    });
  }
}
