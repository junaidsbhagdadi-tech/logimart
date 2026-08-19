import { Injectable, NotFoundException } from '@nestjs/common';
import { RateCard, ServiceMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface WeightLike {
  deadKg: unknown;
  volKg: unknown;
}

export interface ChargeBreakup {
  chargeableKg: number;
  freight: number;
  fuel: number;
  fov: number;
  oda: number;
  docket: number;
  handling: number;
  subtotal: number; // pre-GST total of all charge heads
  lines: { head: string; amount: number }[];
  basis: string; // 'per-kg' | 'ftl' | 'manual'
}

const r2 = (n: number) => +n.toFixed(2);
const DEFAULT_FUEL_CAP = 50; // guardrail: dynamic fuel-surcharge % can't exceed this unless a maxPct is set

@Injectable()
export class RateService {
  constructor(private readonly prisma: PrismaService) {}

  findRate(clientId: bigint, originZone: string, destZone: string, serviceMode: ServiceMode) {
    return this.prisma.rateCard.findFirst({
      where: { clientId, originZone, destZone, serviceMode, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findFtlRate(clientId: bigint, originZone: string, destZone: string, vehicleType: string) {
    return this.prisma.ftlRate.findFirst({
      where: {
        originZone,
        destZone,
        vehicleType,
        effectiveFrom: { lte: new Date() },
        OR: [{ clientId }, { clientId: null }], // client-specific or generic
      },
      orderBy: [{ clientId: 'desc' }, { effectiveFrom: 'desc' }], // prefer client-specific
    });
  }

  chargeableKg(pieces: WeightLike[]): number {
    const dead = pieces.reduce((s, p) => s + Number(p.deadKg), 0);
    const vol = pieces.reduce((s, p) => s + Number(p.volKg), 0);
    return +Math.max(dead, vol).toFixed(3);
  }

  /** Per-kg + surcharges (PTL/Air/Rail). */
  computeCharges(
    rate: RateCard,
    opts: { chargeableKg: number; declaredValue?: number; isOda?: boolean },
  ): ChargeBreakup {
    const { chargeableKg } = opts;
    const declaredValue = opts.declaredValue ?? 0;
    const freight = r2(Math.max(chargeableKg * Number(rate.perKgRate), Number(rate.minCharge)));
    const fuel = r2(freight * (Number(rate.fuelPct) / 100));
    let fov = 0;
    if (Number(rate.fovPct) > 0 || Number(rate.fovMin) > 0) {
      fov = r2(Math.max((declaredValue * Number(rate.fovPct)) / 100, Number(rate.fovMin)));
    }
    let oda = 0;
    if (opts.isOda) {
      oda = r2(Math.max(Number(rate.odaFlat) + Number(rate.odaPerKg) * chargeableKg, Number(rate.odaMin)));
    }
    const docket = r2(Number(rate.docketCharge));
    const handling = r2(Number(rate.handlingCharge));
    const lines = [
      { head: 'Freight', amount: freight },
      { head: `Fuel ${rate.fuelPct}%`, amount: fuel },
      { head: 'FOV / Risk', amount: fov },
      { head: 'ODA', amount: oda },
      { head: 'Docket', amount: docket },
      { head: 'Handling', amount: handling },
    ].filter((l) => l.amount > 0);
    const subtotal = r2(freight + fuel + fov + oda + docket + handling);
    return { chargeableKg, freight, fuel, fov, oda, docket, handling, subtotal, lines, basis: 'per-kg' };
  }

  // ================= Xpresion weight-slab tariff (ClientRateSlab) =================

  /** A slab matches a shipment when each non-null slab dimension equals the shipment's. */
  private slabMatches(s: any, shipment: any): boolean {
    const eq = (a: any, b: any) => !a || (b != null && String(a).toUpperCase() === String(b).toUpperCase());
    return (
      eq(s.zone, shipment.destZone) &&
      eq(s.originZone, shipment.originZone) &&
      eq(s.product, shipment.product) &&
      eq(s.destination, shipment.destPincode) &&
      eq(s.origin, shipment.originPincode)
    );
  }

  /**
   * Resolve freight from matched slabs for a chargeable weight.
   * UPTO = tiered flat table; INITIAL = base up to weight; ADDITIONAL/PLUSKG/PLUS = per-step beyond.
   */
  private priceSlabs(slabs: any[], kg: number): { freight: number; basis: string } | null {
    const by = (t: string) => slabs.filter((s) => String(s.rateType).toUpperCase() === t).sort((a, b) => Number(a.weight) - Number(b.weight));
    const upto = by('UPTO');
    const initial = by('INITIAL');
    const pluskg = by('PLUSKG')[0];                                  // ₹/kg × chargeable weight
    const additional = [...by('ADDITIONAL'), ...by('PLUS')].sort((a, b) => Number(a.weight) - Number(b.weight))[0]; // per weight-block
    // Increment beyond a base weight: PLUSKG is per-kg, ADDITIONAL/PLUS is per block.
    const addBeyond = (base: number, fromKg: number) => {
      const extra = kg - fromKg;
      if (extra <= 0) return base;
      if (pluskg) return base + extra * Number(pluskg.rate);
      if (additional) { const sw = Number(additional.weight) || 1; return base + Math.ceil(extra / sw) * Number(additional.rate); }
      return base;
    };

    if (upto.length) {
      const tier = upto.find((u) => kg <= Number(u.weight));
      if (tier) return { freight: Number(tier.rate), basis: `slab UPTO ${tier.weight}kg` };
      const last = upto[upto.length - 1];
      return { freight: addBeyond(Number(last.rate), Number(last.weight)), basis: `slab UPTO ${last.weight}kg + add` };
    }
    if (initial.length) {
      const init = [...initial].reverse().find((i) => Number(i.weight) <= kg) || initial[0];
      return { freight: addBeyond(Number(init.rate), Number(init.weight)), basis: `slab INITIAL ${init.weight}kg` };
    }
    if (pluskg) return { freight: +(kg * Number(pluskg.rate)).toFixed(2), basis: `slab ₹${pluskg.rate}/kg` }; // pure per-kg
    if (additional) { const sw = Number(additional.weight) || 1; return { freight: Math.ceil(kg / sw) * Number(additional.rate), basis: 'slab per-block' }; }
    return null;
  }

  /** Current diesel price (₹/L) — the variable behind dynamic fuel surcharges. */
  private async currentDieselPrice(): Promise<number> {
    const fp = await this.prisma.fuelPrice.findFirst({ where: { fuelType: 'DIESEL' }, orderBy: { effectiveFrom: 'desc' } });
    return fp ? Number(fp.price) : 0;
  }

  /**
   * Effective per-customer fuel-surcharge %.
   * FLAT   -> the stored percentage.
   * DYNAMIC-> basePct + (currentDiesel - baseFuelPrice) * stepPerRupee, floored at 0.
   */
  /** Customer FOV (Freight On Value) % + min, from the Other Charges "FREIGHT ON VALUE" row. */
  private async customerFov(clientId: bigint): Promise<{ pct: number; min: number } | null> {
    const oc = await this.prisma.customerOtherCharge.findFirst({
      where: { clientId, chargeDesc: { in: ['FREIGHT ON VALUE', 'FOV'] } },
      orderBy: { id: 'desc' },
    });
    return oc ? { pct: Number(oc.value ?? 0), min: Number(oc.minimumValue ?? 0) } : null;
  }

  private async customerFuelPct(clientId: bigint): Promise<number> {
    const fs = await this.prisma.customerFuelSurcharge.findFirst({
      where: { clientId, OR: [{ fromDate: null }, { fromDate: { lte: new Date() } }] },
      orderBy: { id: 'desc' },
    });
    if (!fs) return 0;
    // Params come from the row; a linked Fuel Mechanism master (if set) overrides them.
    let mode = fs.mode, basePct: any = fs.basePct, baseFuel: any = fs.baseFuelPrice, step: any = fs.stepPerRupee, flat: any = fs.percentage, cap: any = fs.maxPct;
    if (fs.mechanism) {
      const m = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'FUEL_MECHANISM', code: fs.mechanism } } });
      const a: any = m?.attrs || {};
      if (m) { mode = a.mode || mode; basePct = a.basePct ?? basePct; baseFuel = a.baseFuelPrice ?? baseFuel; step = a.stepPerRupee ?? step; flat = a.percentage ?? flat; cap = a.maxPct ?? cap; }
    }
    if (String(mode || 'FLAT').toUpperCase() === 'DYNAMIC') {
      const diesel = await this.currentDieselPrice();
      const raw = Number(basePct ?? 0) + (diesel - Number(baseFuel ?? 0)) * Number(step ?? 0);
      const ceiling = cap != null && cap !== '' && Number(cap) > 0 ? Number(cap) : DEFAULT_FUEL_CAP;
      return Math.max(0, Math.min(ceiling, +raw.toFixed(2)));
    }
    return Number(flat ?? 0);
  }

  private isSurface(serviceMode?: string): boolean {
    const m = (serviceMode || '').toUpperCase();
    return m.startsWith('ROAD') || m === 'RAIL' || m.includes('SURFACE');
  }

  /** Customer CFT/volumetric rule (matches product/service when the row specifies them). */
  private async customerVolRule(clientId: bigint, shipment: any) {
    const rules = await this.prisma.customerVolumetric.findMany({ where: { clientId }, orderBy: { id: 'desc' } });
    if (!rules.length) return null;
    const eq = (a: any, b: any) => !a || (b != null && String(a).toUpperCase() === String(b).toUpperCase());
    return rules.find((r) => eq(r.product, shipment.product) && eq(r.service, shipment.serviceMode)) || rules[0];
  }

  /**
   * Chargeable weight. An explicitly entered charge weight is definitive (operator override).
   * Otherwise max(dead, volumetric) — and for SURFACE cargo with a customer CFT rule,
   * volumetric = Σ_boxes (L×W×H / divisor) × CFT-factor; else Σ stored volKg (÷5000).
   */
  async chargeableKgFor(shipment: any, pieces: any[]): Promise<number> {
    if (shipment.chargeWeight != null && Number(shipment.chargeWeight) > 0) {
      return +Number(shipment.chargeWeight).toFixed(3);
    }
    const dead = pieces.reduce((s, p) => s + Number(p.deadKg), 0);
    let vol = pieces.reduce((s, p) => s + Number(p.volKg || 0), 0);
    if (this.isSurface(shipment.serviceMode)) {
      const rule = await this.customerVolRule(shipment.clientId, shipment);
      const divisor = Number(rule?.cmDivide ?? 0);
      const cft = Number(rule?.cft ?? 0);
      if (rule && divisor > 0 && cft > 0) {
        vol = +pieces.reduce((s, p) => {
          const l = Number(p.lengthCm || 0), w = Number(p.widthCm || 0), h = Number(p.heightCm || 0);
          return s + (l && w && h ? (l * w * h / divisor) * cft : 0);
        }, 0).toFixed(3);
      }
    }
    return +Math.max(dead, vol).toFixed(3);
  }

  /** Price a shipment from the Xpresion slab tariff; null if no slab matches (caller falls back). */
  async chargesFromSlabs(shipment: any, chargeableKg: number): Promise<ChargeBreakup | null> {
    const slabs = await this.prisma.clientRateSlab.findMany({
      where: { OR: [{ clientId: shipment.clientId }, { clientId: null }], fromDate: { lte: new Date() } },
    });
    if (!slabs.length) return null;
    const matched = slabs.filter((s) => this.slabMatches(s, shipment));
    if (!matched.length) return null;
    // prefer client-specific slabs over generic ones
    const clientSlabs = matched.filter((s) => s.clientId != null);
    const priced = this.priceSlabs(clientSlabs.length ? clientSlabs : matched, chargeableKg);
    if (!priced) return null;
    const freight = r2(priced.freight);
    const fuelPct = await this.customerFuelPct(shipment.clientId);
    const fuel = r2(freight * (fuelPct / 100));
    // FOV (Freight On Value) — % of the invoice/declared value, from the customer's Other Charges
    const fovCfg = await this.customerFov(shipment.clientId);
    const invVal = Number(shipment.shipmentValue ?? shipment.declaredValue ?? 0);
    const fov = fovCfg ? r2(Math.max((invVal * fovCfg.pct) / 100, fovCfg.min)) : 0;
    const lines = [{ head: `Freight (${priced.basis})`, amount: freight }];
    if (fuel > 0) lines.push({ head: `Fuel ${fuelPct}%`, amount: fuel });
    if (fov > 0) lines.push({ head: `FOV ${fovCfg!.pct}% on ₹${invVal}`, amount: fov });
    return { chargeableKg, freight, fuel, fov, oda: 0, docket: 0, handling: 0, subtotal: r2(freight + fuel + fov), lines, basis: priced.basis };
  }

  /**
   * Resolve charges for a shipment: manual override > FTL flat rate > slab tariff > per-kg.
   * Returns null if no applicable rate is configured (per-kg path).
   */
  async chargesForShipment(shipment: any, pieces: WeightLike[]): Promise<ChargeBreakup | null> {
    const chargeableKg = await this.chargeableKgFor(shipment, pieces);

    // 1) one-time / agreed manual freight override
    if (shipment.manualFreight != null) {
      const freight = r2(Number(shipment.manualFreight));
      return {
        chargeableKg, freight, fuel: 0, fov: 0, oda: 0, docket: 0, handling: 0,
        subtotal: freight, lines: [{ head: 'Freight (agreed)', amount: freight }], basis: 'manual',
      };
    }

    // 2) FTL flat rate by vehicle type
    if (shipment.serviceMode === 'ROAD_FTL' && shipment.ftlVehicleType) {
      const fr = await this.findFtlRate(shipment.clientId, shipment.originZone, shipment.destZone, shipment.ftlVehicleType);
      if (fr) {
        const freight = r2(Number(fr.flatRate));
        const fuel = r2(freight * (Number(fr.fuelPct) / 100));
        const lines = [{ head: `FTL ${shipment.ftlVehicleType}`, amount: freight }];
        if (fuel > 0) lines.push({ head: `Fuel ${fr.fuelPct}%`, amount: fuel });
        return { chargeableKg, freight, fuel, fov: 0, oda: 0, docket: 0, handling: 0, subtotal: r2(freight + fuel), lines, basis: 'ftl' };
      }
    }

    // 3) Xpresion weight-slab tariff (Customer Rate) — preferred over the per-kg card
    const slabBreakup = await this.chargesFromSlabs(shipment, chargeableKg);
    if (slabBreakup) return slabBreakup;

    // 4) per-kg rate card (fallback)
    const rate = await this.findRate(shipment.clientId, shipment.originZone, shipment.destZone, shipment.serviceMode);
    if (!rate) return null;
    return this.computeCharges(rate, {
      chargeableKg,
      declaredValue: shipment.declaredValue ? Number(shipment.declaredValue) : 0,
      isOda: shipment.isOda,
    });
  }

  async quoteForShipment(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { pieces: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    const breakup = await this.chargesForShipment(s, s.pieces);
    if (!breakup) {
      throw new NotFoundException(
        `No rate for ${s.originZone}->${s.destZone} (${s.serviceMode}${s.ftlVehicleType ? ' ' + s.ftlVehicleType : ''}). Add a Customer Rate slab / rate card / FTL rate, or enter an agreed freight.`,
      );
    }
    const gst = r2(breakup.subtotal * 0.18);
    return {
      awb: s.awb, lane: `${s.originZone} -> ${s.destZone}`, serviceMode: s.serviceMode,
      isOda: s.isOda, declaredValue: s.declaredValue, ...breakup, gst, grandTotal: r2(breakup.subtotal + gst),
    };
  }
}
