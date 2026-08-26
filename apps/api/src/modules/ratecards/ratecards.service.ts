import { Injectable, NotFoundException } from '@nestjs/common';
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
    flatRate: number; fuelPct?: number; gstPct?: number; effectiveFrom?: string;
  }) {
    return this.prisma.ftlRate.create({
      data: {
        clientId: dto.clientId != null ? BigInt(dto.clientId) : null,
        originZone: dto.originZone,
        destZone: dto.destZone,
        vehicleType: dto.vehicleType,
        flatRate: dec(dto.flatRate),
        fuelPct: dec(dto.fuelPct),
        gstPct: dto.gstPct != null ? dec(dto.gstPct) : dec(18),
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
      volumetricDivisor: dec(Math.min(27000, num(d.volumetricDivisor, 5000))), // hard cap 27000
      cft: dec(num(d.cft)),
      minChargeableKg: dec(num(d.minChargeableKg)),
      minFreight: dec(num(d.minFreight)),
      addlWeightUnitG: num(d.addlWeightUnitG, 1000),
      cityWiseRates: !!d.cityWiseRates,
      cityRates: Array.isArray(d.cityRates)
        ? d.cityRates
            .filter((c: any) => c && String(c.city ?? '').trim() && Number(c.perKg) > 0)
            .map((c: any) => ({ city: String(c.city).trim().toUpperCase(), perKg: Number(c.perKg), min: c.min != null && c.min !== '' ? Number(c.min) : 0 }))
        : [],
      rateAboveKg: d.rateAboveKg != null && d.rateAboveKg !== '' ? dec(num(d.rateAboveKg)) : null,
      rateAboveKgRate: d.rateAboveKgRate != null && d.rateAboveKgRate !== '' ? dec(num(d.rateAboveKgRate)) : null,
      volDiscountPct: dec(num(d.volDiscountPct)),
      handlingBands: Array.isArray(d.handlingBands) ? d.handlingBands : [],
      ospCharge: dec(num(d.ospCharge)),
      charges: d.charges && typeof d.charges === 'object' ? d.charges : {},
      awbCharge: dec(num(d.awbCharge)),
      emergencyCharge: dec(num(d.emergencyCharge)),
      environmentCharge: dec(num(d.environmentCharge)),
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
        originZone: s.originZone ? String(s.originZone).toUpperCase() : null,
        zone: String(s.zone).toUpperCase(),
        rateType: String(s.rateType).toUpperCase(),
        weight: dec(Number(s.weight ?? 0)),
        rate: dec(Number(s.rate ?? 0)),
        slabOrder: s.slabOrder != null ? Number(s.slabOrder) : i,
      }));
  }

  /** Create a card header + its slab grid in one shot. Owned by a customer (clientId) OR a vendor (ownerVendorId). */
  createCard(d: any) {
    return this.prisma.customerRateCard.create({
      data: {
        clientId: d.clientId != null && d.clientId !== '' ? BigInt(d.clientId) : null,
        ownerVendorId: d.ownerVendorId != null && d.ownerVendorId !== '' ? BigInt(d.ownerVendorId) : null,
        ...this.cardHeader(d),
        slabs: { create: this.slabRows(d.slabs) },
      },
      include: { slabs: true },
    });
  }

  /** All cards for a customer OR a vendor (or every card) with their slabs — feeds the eye-popout. */
  listCards(clientId?: number, vendorId?: number) {
    const where = clientId != null ? { clientId: BigInt(clientId) }
      : vendorId != null ? { ownerVendorId: BigInt(vendorId) }
      : undefined;
    return this.prisma.customerRateCard.findMany({
      where,
      orderBy: [{ network: 'asc' }, { product: 'asc' }],
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

  /**
   * Copy the accessorial "other charges" from one card to every other card of the SAME customer &
   * product (all vendors + SELF), leaving each card's freight grid / fuel / divisor untouched (#10).
   * The copied charges remain editable per vendor afterwards.
   */
  async copyChargesToSiblings(id: number) {
    const src = await this.prisma.customerRateCard.findUnique({ where: { id: BigInt(id) } });
    if (!src) throw new NotFoundException('Rate card not found');
    const owner = src.clientId != null ? { clientId: src.clientId } : { ownerVendorId: src.ownerVendorId };
    const siblings = await this.prisma.customerRateCard.findMany({
      where: { ...owner, product: src.product, id: { not: src.id } },
      select: { id: true, network: true },
    });
    const data: Prisma.CustomerRateCardUpdateInput = {
      charges: (src.charges as any) ?? {},
      // volumetric rule travels with the charges so every vendor computes weight the same way
      volumetricDivisor: src.volumetricDivisor, cft: src.cft, minChargeableKg: src.minChargeableKg,
      fovPct: src.fovPct, fovMin: src.fovMin,
      odaFlat: src.odaFlat, odaPerKg: src.odaPerKg, odaMin: src.odaMin,
      topayCharge: src.topayCharge, apptCharge: src.apptCharge,
      loadingCharge: src.loadingCharge, unloadingCharge: src.unloadingCharge,
      docketCharge: src.docketCharge, awbCharge: src.awbCharge,
      emergencyCharge: src.emergencyCharge, environmentCharge: src.environmentCharge,
      ospCharge: src.ospCharge, handlingBands: (src.handlingBands as any) ?? [],
    };
    for (const s of siblings) await this.prisma.customerRateCard.update({ where: { id: s.id }, data });
    return { ok: true, product: src.product, copiedTo: siblings.length, networks: siblings.map((s) => s.network) };
  }

  // ============================================================================
  // EDL (= ODA) matrix — one standard km-band × weight-band table per vendor/network.
  // ============================================================================

  listEdl(network?: string) {
    return this.prisma.edlRate.findMany({
      where: network ? { network: network.toUpperCase() } : undefined,
      orderBy: [{ network: 'asc' }, { kmFrom: 'asc' }, { wtFromKg: 'asc' }],
      take: 5000,
    });
  }

  /** Replace a network's EDL matrix with the uploaded cells. Rows: {kmFrom,kmTo,wtFromKg,wtToKg,rate}. */
  async bulkEdl(network: string, rows: any[]) {
    const net = (network || 'SELF').toUpperCase();
    const clean = (rows || [])
      .filter((r) => r && r.rate != null && r.rate !== '')
      .map((r) => ({
        network: net, kmFrom: Number(r.kmFrom ?? 0), kmTo: Number(r.kmTo ?? 0),
        wtFromKg: Number(r.wtFromKg ?? 0), wtToKg: Number(r.wtToKg ?? 0), rate: dec(Number(r.rate ?? 0)),
      }));
    await this.prisma.edlRate.deleteMany({ where: { network: net } });
    if (clean.length) await this.prisma.edlRate.createMany({ data: clean });
    return { network: net, imported: clean.length };
  }
}
