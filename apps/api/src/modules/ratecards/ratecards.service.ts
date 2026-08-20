import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRateCardDto } from './dto/ratecard.dto';

const dec = (n?: number) => new Prisma.Decimal(n ?? 0);

@Injectable()
export class RateCardsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateRateCardDto) {
    return this.prisma.rateCard.create({
      data: {
        clientId: BigInt(dto.clientId),
        originZone: dto.originZone,
        destZone: dto.destZone,
        serviceMode: dto.serviceMode,
        perKgRate: dec(dto.perKgRate),
        minCharge: dec(dto.minCharge),
        fuelPct: dec(dto.fuelPct),
        fovPct: dec(dto.fovPct),
        fovMin: dec(dto.fovMin),
        odaFlat: dec(dto.odaFlat),
        odaPerKg: dec(dto.odaPerKg),
        odaMin: dec(dto.odaMin),
        docketCharge: dec(dto.docketCharge),
        handlingCharge: dec(dto.handlingCharge),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      },
    });
  }

  list(clientId?: number) {
    return this.prisma.rateCard.findMany({
      where: clientId != null ? { clientId: BigInt(clientId) } : undefined,
      orderBy: [{ clientId: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  // ---- FTL rates (per vehicle type / trip) ----
  createFtl(dto: {
    clientId?: number; originZone: string; destZone: string; vehicleType: string;
    flatRate: number; fuelPct?: number; effectiveFrom?: string;
  }) {
    return this.prisma.ftlRate.create({
      data: {
        clientId: dto.clientId != null ? BigInt(dto.clientId) : null,
        originZone: dto.originZone,
        destZone: dto.destZone,
        vehicleType: dto.vehicleType,
        flatRate: dec(dto.flatRate),
        fuelPct: dec(dto.fuelPct),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      },
    });
  }

  listFtl() {
    return this.prisma.ftlRate.findMany({ orderBy: [{ clientId: 'asc' }, { effectiveFrom: 'desc' }] });
  }

  // ============================================================================
  // Revamped CustomerRateCard: one card per customer × network × product,
  // owning its zone × slab grid + all accessorials. Billing-app "eye → popout".
  // ============================================================================

  private cardHeader(d: any) {
    const num = (v: any, dflt = 0) => (v != null && v !== '' ? Number(v) : dflt);
    return {
      network: (d.network || 'SELF').toUpperCase(),
      vendor: d.vendor || null,
      product: d.product,
      mode: d.mode || null,
      service: d.service || null,
      label: d.label || null,
      volumetricDivisor: dec(num(d.volumetricDivisor, 5000)),
      cft: dec(num(d.cft)),
      minChargeableKg: dec(num(d.minChargeableKg)),
      minFreight: dec(num(d.minFreight)),
      addlWeightUnitG: num(d.addlWeightUnitG, 1000),
      fuelMode: (d.fuelMode || 'FLAT').toUpperCase() === 'DYNAMIC' ? 'DYNAMIC' : 'FLAT',
      fuelPct: dec(num(d.fuelPct)),
      fuelMechanism: d.fuelMechanism || null,
      fovPct: dec(num(d.fovPct)),
      fovMin: dec(num(d.fovMin)),
      odaFlat: dec(num(d.odaFlat)),
      odaPerKg: dec(num(d.odaPerKg)),
      odaMin: dec(num(d.odaMin)),
      topayCharge: dec(num(d.topayCharge)),
      apptCharge: dec(num(d.apptCharge)),
      loadingCharge: dec(num(d.loadingCharge)),
      unloadingCharge: dec(num(d.unloadingCharge)),
      docketCharge: dec(num(d.docketCharge)),
      validFrom: d.validFrom ? new Date(d.validFrom) : new Date(),
      validTo: d.validTo ? new Date(d.validTo) : null,
      isActive: d.isActive != null ? !!d.isActive : true,
    };
  }

  private slabRows(slabs: any[] = []) {
    return slabs
      .filter((s) => s && s.zone && s.rateType && s.rate != null && s.rate !== '')
      .map((s, i) => ({
        zone: String(s.zone).toUpperCase(),
        rateType: String(s.rateType).toUpperCase(),
        weight: dec(Number(s.weight ?? 0)),
        rate: dec(Number(s.rate ?? 0)),
        slabOrder: s.slabOrder != null ? Number(s.slabOrder) : i,
      }));
  }

  /** Create a card header + its slab grid in one shot. */
  createCard(d: any) {
    return this.prisma.customerRateCard.create({
      data: {
        clientId: BigInt(d.clientId),
        ...this.cardHeader(d),
        slabs: { create: this.slabRows(d.slabs) },
      },
      include: { slabs: true },
    });
  }

  /** All cards for a customer (or every card) with their slabs — feeds the eye-popout. */
  listCards(clientId?: number) {
    return this.prisma.customerRateCard.findMany({
      where: clientId != null ? { clientId: BigInt(clientId) } : undefined,
      orderBy: [{ clientId: 'asc' }, { network: 'asc' }, { product: 'asc' }],
      include: { slabs: { orderBy: [{ rateType: 'asc' }, { weight: 'asc' }] } },
      take: 2000,
    });
  }

  getCard(id: number) {
    return this.prisma.customerRateCard.findUnique({
      where: { id: BigInt(id) },
      include: { slabs: { orderBy: [{ rateType: 'asc' }, { weight: 'asc' }] } },
    });
  }

  /** Update header; if `slabs` is supplied, replace the whole grid atomically. */
  async updateCard(id: number, d: any) {
    const cardId = BigInt(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.customerRateCard.update({ where: { id: cardId }, data: this.cardHeader(d) });
      if (Array.isArray(d.slabs)) {
        await tx.customerRateCardSlab.deleteMany({ where: { rateCardId: cardId } });
        if (d.slabs.length) {
          await tx.customerRateCardSlab.createMany({
            data: this.slabRows(d.slabs).map((s) => ({ ...s, rateCardId: cardId })),
          });
        }
      }
      return tx.customerRateCard.findUnique({ where: { id: cardId }, include: { slabs: true } });
    });
  }

  removeCard(id: number) {
    return this.prisma.customerRateCard.delete({ where: { id: BigInt(id) } });
  }
}
