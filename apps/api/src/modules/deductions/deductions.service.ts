import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface DeductionInput {
  awb: string;
  vendorName: string;
  vendorAcCode?: string;
  pickupDate?: string;
  deliveryDate?: string;
  emailCommDate?: string;
  madeToNames?: string;
  reason?: string;
  amount?: number;
  attachment?: string;
  customerCode?: string;
}

@Injectable()
export class DeductionsService {
  constructor(private readonly prisma: PrismaService) {}

  private monthOf(d?: string): string | null {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  }

  list(month?: string) {
    return this.prisma.vendorDeduction.findMany({
      where: month ? { periodMonth: month } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: DeductionInput, userId?: number) {
    const d = (s?: string) => (s ? new Date(s) : null);
    // Bucket the row by the pickup date (else the email-comm date, else now).
    const period = this.monthOf(dto.pickupDate) || this.monthOf(dto.emailCommDate) || this.monthOf(new Date().toISOString());
    return this.prisma.vendorDeduction.create({
      data: {
        awb: String(dto.awb || '').trim().toUpperCase(),
        vendorName: dto.vendorName?.trim() || '',
        vendorAcCode: dto.vendorAcCode?.trim() || null,
        pickupDate: d(dto.pickupDate),
        deliveryDate: d(dto.deliveryDate),
        emailCommDate: d(dto.emailCommDate),
        madeToNames: dto.madeToNames?.trim() || null,
        reason: dto.reason?.trim() || null,
        amount: new Prisma.Decimal(Number(dto.amount) || 0),
        attachment: dto.attachment?.trim() || null,
        customerCode: dto.customerCode?.trim()?.toUpperCase() || null,
        periodMonth: period,
        createdById: userId != null ? BigInt(userId) : null,
      },
    });
  }

  async remove(id: number) {
    const row = await this.prisma.vendorDeduction.findUnique({ where: { id: BigInt(id) }, select: { id: true } });
    if (!row) throw new NotFoundException('Deduction not found');
    await this.prisma.vendorDeduction.delete({ where: { id: BigInt(id) } });
    return { ok: true, id };
  }
}
