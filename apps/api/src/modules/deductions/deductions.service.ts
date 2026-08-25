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
  approvedAmount?: number;
  status?: string;
  remark?: string;
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

  /** Auto-fill helper: pull vendor / customer / pickup+delivery dates for an AWB. */
  async awbLookup(awbRaw: string) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    if (!awb) return null;
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      include: { client: { select: { accountCode: true, legalName: true } } },
    });
    if (!s) return null;
    // Resolve the vendor name/code from the shipment's network (e.g. "BLUEDART-SFC" → Blue Dart).
    let vendorName = s.vendor || '';
    let vendorAcCode = '';
    if (s.vendor) {
      const prefix = s.vendor.split('-')[0];
      const v = await this.prisma.vendor.findFirst({
        where: { OR: [{ vendorCode: s.vendor }, { name: s.vendor }, { vendorCode: prefix }, { name: { contains: prefix, mode: 'insensitive' } }] },
        select: { name: true, vendorCode: true },
      });
      if (v) { vendorName = v.name; vendorAcCode = v.vendorCode || ''; }
    }
    const scans = await this.prisma.scanLog.findMany({ where: { awb, eventType: { in: ['PKD', 'DLD'] } }, orderBy: { scanAt: 'asc' }, select: { eventType: true, scanAt: true } });
    const iso = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    const pkd = scans.find((x) => x.eventType === 'PKD');
    const dld = scans.find((x) => x.eventType === 'DLD');
    return {
      awb,
      vendorName,
      vendorAcCode,
      customerCode: s.client?.accountCode ?? '',
      pickupDate: iso(pkd?.scanAt ?? s.createdAt),
      deliveryDate: iso(dld?.scanAt),
    };
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
        approvedAmount: dto.approvedAmount != null && !isNaN(Number(dto.approvedAmount)) ? new Prisma.Decimal(Number(dto.approvedAmount)) : null,
        status: dto.status?.trim() || 'ongoing',
        remark: dto.remark?.trim() || null,
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
