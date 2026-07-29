import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: any) {
    return this.prisma.vendor.create({
      data: {
        name: dto.name,
        modes: (dto.modes || []).join?.(',') ?? dto.modes ?? '',
        gstin: dto.gstin,
        pan: dto.pan,
        addressLine: dto.addressLine,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        contactEmail: dto.contactEmail,
      },
    });
  }

  async list() {
    const vendors = await this.prisma.vendor.findMany({
      orderBy: { name: 'asc' },
      include: { payments: true },
    });
    return vendors.map((v) => {
      const advPaid = v.payments.filter((p) => p.kind === 'advance' && p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0);
      const advPending = v.payments.filter((p) => p.kind === 'advance' && p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0);
      return { ...v, payments: undefined, advancePaid: advPaid, advancePending: advPending };
    });
  }

  async get(id: number) {
    const v = await this.prisma.vendor.findUnique({
      where: { id: BigInt(id) },
      include: { payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  addPayment(id: number, dto: any) {
    return this.prisma.vendorPayment.create({
      data: {
        vendorId: BigInt(id),
        amount: new Prisma.Decimal(dto.amount),
        tds: new Prisma.Decimal(dto.tds ?? 0),
        kind: dto.kind || 'advance', // advance | settlement
        status: dto.status || 'pending', // pending | paid
        reference: dto.reference,
        notes: dto.notes,
      },
    });
  }

  async markPaid(paymentId: number) {
    return this.prisma.vendorPayment.update({ where: { id: BigInt(paymentId) }, data: { status: 'paid' } });
  }
}
