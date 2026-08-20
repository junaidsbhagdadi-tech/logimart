import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const dec = (n: any) => (n != null && n !== '' ? new Prisma.Decimal(n) : null);
const dec0 = (n: any) => new Prisma.Decimal(n ?? 0);
const up = (s: any) => String(s ?? '').trim().toUpperCase();

/**
 * Billing-app-style rate cards: one card per (customer, productType, serviceType) holding
 * weight-bracket slabs (from–to grams) × zone → rate, plus card-level surcharges, an optional
 * flat-rate override, a volume discount, and validity dates.
 */
@Injectable()
export class CarrierRatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(clientId?: number) {
    return this.prisma.carrierRateCard.findMany({
      where: clientId != null ? { clientId: BigInt(clientId) } : undefined,
      orderBy: [{ clientId: 'asc' }, { productType: 'asc' }, { serviceType: 'asc' }],
      include: { slabs: { orderBy: { slabOrder: 'asc' } } },
    });
  }

  create(d: any) {
    const slabs: any[] = Array.isArray(d.slabs) ? d.slabs : [];
    return this.prisma.carrierRateCard.create({
      data: {
        clientId: BigInt(d.clientId),
        productType: up(d.productType),
        serviceType: up(d.serviceType),
        rateType: d.rateType || 'PER_UNIT',
        fuelSurchargePct: dec0(d.fuelSurchargePct),
        fovPct: dec(d.fovPct),
        fovMinAmount: dec(d.fovMinAmount),
        odaCharge: dec(d.odaCharge),
        codPct: dec(d.codPct),
        codMinAmount: dec(d.codMinAmount),
        rtoCost: dec(d.rtoCost),
        discountMinAmount: dec(d.discountMinAmount),
        discountPct: dec(d.discountPct),
        flatRate: dec(d.flatRate),
        effectiveFrom: d.effectiveFrom ? new Date(d.effectiveFrom) : null,
        effectiveTo: d.effectiveTo ? new Date(d.effectiveTo) : null,
        slabs: {
          create: slabs.map((s, i) => ({
            slabOrder: s.slabOrder ?? i,
            fromWeightGrams: Number(s.fromWeightGrams ?? 0),
            toWeightGrams: s.toWeightGrams != null && s.toWeightGrams !== '' ? Number(s.toWeightGrams) : null,
            zone: up(s.zone),
            rate: dec0(s.rate),
          })),
        },
      },
      include: { slabs: true },
    });
  }

  remove(id: number) {
    return this.prisma.carrierRateCard.delete({ where: { id: BigInt(id) } });
  }
}
