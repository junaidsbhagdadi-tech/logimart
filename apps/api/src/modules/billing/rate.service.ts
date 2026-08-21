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
  topay?: number;
  appt?: number;
  loading?: number;
  unloading?: number;
  awb?: number;
  emergency?: number;
  environment?: number;
  osp?: number;
  subtotal: number; // pre-GST total of all charge heads
  lines: { head: string; amount: number }[];
  basis: string; // 'card:… | slab… | per-kg | ftl | manual'
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
      eq(s.vendor, shipment.vendor) && // the booking-picked carrier product (e.g. BLUEDART-APEX)
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
    // Courier (DP/TDD/NDD): first 250g / first 500g base + every additional 500g.
    const first250 = by('FIRST250')[0], first500 = by('FIRST500')[0], add500 = by('ADD500')[0];
    if (first250 || first500 || add500) {
      const base = first500 || first250;
      if (first250 && kg <= 0.25) return { freight: Number(first250.rate), basis: 'courier first-250g' };
      if (base && kg <= 0.5) return { freight: Number(base.rate), basis: 'courier first-500g' };
      if (base) {
        const steps = Math.ceil(Math.max(0, kg - 0.5) / 0.5);
        const add = add500 ? steps * Number(add500.rate) : 0;
        return { freight: +(Number(base.rate) + add).toFixed(2), basis: `courier 500g + ${steps}×500g` };
      }
    }
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
      // variable part applies only to the rise above a reference diesel price; blank/0 ref => base only
      const rise = Number(baseFuel) > 0 ? diesel - Number(baseFuel) : 0;
      const raw = Number(basePct ?? 0) + rise * Number(step ?? 0);
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
    // Pick the most specific coherent set: client+vendor > client > vendor > generic.
    const vend = String(shipment.vendor ?? '').toUpperCase();
    const vendorMatch = (s: any) => !!s.vendor && String(s.vendor).toUpperCase() === vend;
    const tiers = [
      matched.filter((s) => s.clientId != null && vendorMatch(s)),
      matched.filter((s) => s.clientId != null),
      matched.filter((s) => vendorMatch(s)),
      matched,
    ];
    const use = tiers.find((t) => t.length > 0) ?? matched;
    const priced = this.priceSlabs(use, chargeableKg);
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

  // ================= Revamped CustomerRateCard (primary tariff) =================

  /** Network the shipment routes on: SELF, BLUEDART, or the vendor code. */
  private deriveNetwork(shipment: any): string {
    const v = String(shipment.vendor ?? '').toUpperCase();
    if (!v) return 'SELF';
    if (v.startsWith('BLUEDART')) return 'BLUEDART';
    return v;
  }

  /** Best-matching active card for the shipment: same product, then exact network > SELF > any. */
  async resolveRateCard(shipment: any) {
    const now = new Date();
    const cards = await this.prisma.customerRateCard.findMany({
      where: { clientId: shipment.clientId, isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
      include: { slabs: true },
    });
    if (!cards.length) return null;
    const prod = String(shipment.product ?? '').toUpperCase();
    const net = this.deriveNetwork(shipment);
    const byProduct = cards.filter((c) => !prod || String(c.product).toUpperCase() === prod);
    const pool = byProduct.length ? byProduct : cards;
    return (
      pool.find((c) => String(c.network).toUpperCase() === net) ||
      pool.find((c) => String(c.network).toUpperCase() === 'SELF') ||
      pool[0]
    );
  }

  /**
   * Effective FSC % for a card.
   * DYNAMIC  -> its diesel-linked FUEL_MECHANISM master.
   * FLAT     -> an explicit % on the card wins; if blank, inherit a master FLAT mechanism —
   *             the one the card references, else the one flagged default — so every air card
   *             can share one fuel % set once in Masters.
   */
  private async cardFuelPct(card: any): Promise<number> {
    const wantDynamic = String(card.fuelMode ?? 'FLAT').toUpperCase() === 'DYNAMIC';
    // FLAT: an explicit % on the card wins outright.
    if (!wantDynamic) { const flat = Number(card.fuelPct ?? 0); if (flat > 0) return flat; }
    const mechs = await this.prisma.masterEntry.findMany({ where: { type: 'FUEL_MECHANISM', active: true } });
    // An explicitly-linked mechanism wins (either mode).
    if (card.fuelMechanism) { const r = mechs.find((x) => x.code === card.fuelMechanism); if (r) return this.pctFromMechanism(r); }
    // Otherwise inherit the default mechanism of the SAME family — DYNAMIC (diesel/Surface) or FLAT
    // (air/Express/DP) — with a network-specific default beating the all-vendors one. This is why a
    // Surface card follows the diesel mechanism automatically (base % + diesel rise) without per-card linking.
    const net = String(card.network ?? 'SELF').toUpperCase();
    const defaults = mechs.filter((x) => { const a: any = x.attrs || {}; return a.isDefault && (String(a.mode ?? 'FLAT').toUpperCase() === 'DYNAMIC') === wantDynamic; });
    const m = defaults.find((x) => String((x.attrs as any)?.network ?? '').trim().toUpperCase() === net)
           || defaults.find((x) => !String((x.attrs as any)?.network ?? '').trim());
    return m ? this.pctFromMechanism(m) : 0;
  }

  /** FSC % from a FUEL_MECHANISM master code (0 if missing). */
  private async mechanismPct(code?: string | null): Promise<number> {
    if (!code) return 0;
    const m = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'FUEL_MECHANISM', code } } });
    return m ? this.pctFromMechanism(m) : 0;
  }

  /** FSC % implied by a mechanism row — FLAT reads its percentage; DYNAMIC indexes off current diesel. */
  private async pctFromMechanism(m: any): Promise<number> {
    const a: any = m.attrs || {};
    if (String(a.mode ?? 'FLAT').toUpperCase() !== 'DYNAMIC') return Number(a.percentage ?? 0);
    const basePct = Number(a.basePct ?? 0), baseFuel = Number(a.baseFuelPrice ?? 0), step = Number(a.stepPerRupee ?? 0), cap = Number(a.maxPct ?? 0);
    const diesel = await this.currentDieselPrice();
    const rise = baseFuel > 0 ? diesel - baseFuel : 0;
    const raw = basePct + rise * step;
    const ceiling = cap > 0 ? cap : DEFAULT_FUEL_CAP;
    return Math.max(0, Math.min(ceiling, +raw.toFixed(2)));
  }

  /** Chargeable weight under a card: operator override > max(dead, card-volumetric, minChargeableKg). */
  private cardChargeableKg(shipment: any, pieces: any[], card: any): number {
    if (shipment.chargeWeight != null && Number(shipment.chargeWeight) > 0) return +Number(shipment.chargeWeight).toFixed(3);
    const dead = pieces.reduce((s, p) => s + Number(p.deadKg), 0);
    let vol = pieces.reduce((s, p) => s + Number(p.volKg || 0), 0);
    if (this.isSurface(shipment.serviceMode)) {
      const divisor = Number(card.volumetricDivisor ?? 0), cft = Number(card.cft ?? 0);
      if (divisor > 0 && cft > 0) {
        vol = +pieces.reduce((s, p) => {
          const l = Number(p.lengthCm || 0), w = Number(p.widthCm || 0), h = Number(p.heightCm || 0);
          return s + (l && w && h ? (l * w * h / divisor) * cft : 0);
        }, 0).toFixed(3);
      }
    }
    return +Math.max(dead, vol, Number(card.minChargeableKg ?? 0)).toFixed(3);
  }

  /**
   * EDL (= ODA) from the network's standard matrix when the destination pincode is an
   * EDL location. Matrix cell by (distance-km band × chargeable-weight band); fallbacks:
   * North-East → max(₹15/kg, ₹3000); >500km → ₹14/km; >1500kg → ₹5/kg (whichever higher).
   */
  private async edlCharge(network: string, destPin: any, weightKg: number): Promise<number> {
    if (!destPin || !destPin.edl || String(destPin.edl).toUpperCase() === 'REGULAR') return 0;
    if (String(destPin.region ?? '').toUpperCase() === 'NORTHEAST') return r2(Math.max(weightKg * 15, 3000));
    const dist = destPin.edlDistanceKm != null ? Number(destPin.edlDistanceKm) : null;
    if (dist == null) return 0;
    const rows = await this.prisma.edlRate.findMany({ where: { network } });
    const cell = rows.find((r) => dist >= r.kmFrom && dist <= r.kmTo && weightKg >= r.wtFromKg && weightKg <= r.wtToKg);
    if (cell) return r2(Number(cell.rate));
    const byKm = dist > 500 ? dist * 14 : 0;
    const byKg = weightKg > 1500 ? weightKg * 5 : 0;
    return byKm || byKg ? r2(Math.max(byKm, byKg)) : 0;
  }

  /** Price a shipment fully from its CustomerRateCard: freight (slabs) + every accessorial on the card. */
  async chargesFromRateCard(shipment: any, pieces: any[]): Promise<ChargeBreakup | null> {
    const card = await this.resolveRateCard(shipment);
    if (!card) return null;
    const chargeableKg = this.cardChargeableKg(shipment, pieces, card);
    const eq = (a: any, b: any) => !a || (b != null && String(a).toUpperCase() === String(b).toUpperCase());
    const zoneSlabs = card.slabs.filter((s: any) => eq(s.zone, shipment.destZone) && eq(s.originZone, shipment.originZone));
    const priced = this.priceSlabs(zoneSlabs.length ? zoneSlabs : card.slabs, chargeableKg);
    if (!priced) return null;

    const freight = r2(Math.max(priced.freight, Number(card.minFreight ?? 0)));
    const fuelPct = await this.cardFuelPct(card);
    const fuel = r2(freight * (fuelPct / 100));
    const invVal = Number(shipment.shipmentValue ?? shipment.declaredValue ?? 0);
    // Accessorial values are master-driven: read from the card's `charges` JSON keyed by
    // CHARGE code, falling back to the legacy fixed column so existing cards bill unchanged.
    const CJ: any = card.charges || {};
    const cget = (code: string, k: 'value' | 'min', legacy: any) => {
      const j = CJ[code] ?? CJ[code.toUpperCase()];
      const v = j && j[k] != null && j[k] !== '' ? Number(j[k]) : Number(legacy ?? 0);
      return isNaN(v) ? 0 : v;
    };
    let fov = 0;
    const fovPct = cget('FOV', 'value', card.fovPct), fovMin = cget('FOV', 'min', card.fovMin);
    if (fovPct > 0 || fovMin > 0) fov = r2(Math.max((invVal * fovPct) / 100, fovMin));
    // ODA: the network EDL matrix wins when the destination is an EDL location; else the card's ODA.
    let oda = 0;
    let odaLabel = 'ODA';
    const destPin = shipment.destPincode ? await this.prisma.pincode.findUnique({ where: { pincode: shipment.destPincode } }) : null;
    const edl = await this.edlCharge(this.deriveNetwork(shipment), destPin, chargeableKg);
    const odaFlat = cget('ODA', 'value', card.odaFlat), odaMin = cget('ODA', 'min', card.odaMin);
    const odaPerKg = CJ.ODA?.perKg != null && CJ.ODA?.perKg !== '' ? Number(CJ.ODA.perKg) : Number(card.odaPerKg ?? 0);
    if (edl > 0) { oda = edl; odaLabel = 'EDL (ODA)'; }
    else if (shipment.isOda && (odaFlat > 0 || odaPerKg > 0 || odaMin > 0)) {
      oda = r2(Math.max(odaFlat + odaPerKg * chargeableKg, odaMin));
    }
    const topay = shipment.paymentTerm === 'TO_PAY' ? r2(cget('TOPAY', 'value', card.topayCharge)) : 0;
    const appt = shipment.apptDelivery ? r2(cget('APPT', 'value', card.apptCharge)) : 0;
    const loading = r2(cget('LOADING', 'value', card.loadingCharge));
    const unloading = r2(cget('UNLOADING', 'value', card.unloadingCharge));
    const docket = r2(cget('DOCKET', 'value', card.docketCharge));
    const awb = r2(cget('AWB', 'value', card.awbCharge));
    const emergency = r2(cget('EMERGENCY', 'value', card.emergencyCharge));
    const environment = r2(cget('ENVIRONMENT', 'value', card.environmentCharge));
    // handling: weight-banded ₹/pcs; OSP: oversize (dim>119cm or pcs>69kg)
    const pcs = pieces.length;
    const bands: any[] = Array.isArray(card.handlingBands) ? card.handlingBands : [];
    const hb = bands.find((b) => chargeableKg >= Number(b.fromKg ?? 0) && chargeableKg <= Number(b.toKg ?? 1e9));
    const handling = hb ? r2(Number(hb.perPcs ?? 0) * pcs) : 0;
    const oversize = pieces.some((p) => Number(p.deadKg) > 69 || [p.lengthCm, p.widthCm, p.heightCm].some((d) => Number(d || 0) > 119));
    const osp = oversize ? r2(cget('OSP', 'value', card.ospCharge)) : 0;

    // Custom charges: any CHARGE-master code configured on the card beyond the built-in heads.
    const BUILT_IN = new Set(['FOV', 'ODA', 'TOPAY', 'APPT', 'LOADING', 'UNLOADING', 'DOCKET', 'AWB', 'EMERGENCY', 'ENVIRONMENT', 'ENVIRONMENTAL', 'OSP', 'FSC', 'FUEL', 'FREIGHT']);
    const customLines: { head: string; amount: number }[] = [];
    let customTotal = 0;
    if (Object.keys(CJ).length) {
      const master = await this.prisma.masterEntry.findMany({ where: { type: 'CHARGE', active: true } });
      for (const cm of master) {
        const code = cm.code.toUpperCase();
        if (BUILT_IN.has(code)) continue;
        const conf = CJ[cm.code] ?? CJ[code];
        const v = conf && conf.value != null && conf.value !== '' ? Number(conf.value) : 0;
        if (!v) continue;
        const baseOn = String((cm.attrs as any)?.baseOn || 'FLAT').toUpperCase();
        let amt = baseOn === 'FREIGHT' ? (freight * v) / 100
          : baseOn.includes('VALUE') ? Math.max((invVal * v) / 100, Number(conf.min ?? 0))
          : baseOn.includes('WEIGHT') ? v * chargeableKg
          : v; // FLAT
        amt = r2(amt);
        if (amt > 0) { customLines.push({ head: cm.name, amount: amt }); customTotal += amt; }
      }
    }

    const lines = [{ head: `Freight (${priced.basis})`, amount: freight }];
    // DYNAMIC FSC is diesel-indexed (Surface) → label it "Diesel Surcharge"; FLAT (Air/Express/DP) stays "Fuel".
    const fscLabel = String(card.fuelMode ?? 'FLAT').toUpperCase() === 'DYNAMIC' ? 'Diesel Surcharge' : 'Fuel';
    if (fuel > 0) lines.push({ head: `${fscLabel} ${fuelPct}%`, amount: fuel });
    if (fov > 0) {
      // Label from the EFFECTIVE FOV (charges JSON), not the stale card.fovPct column — otherwise a
      // card that bills 0.2% via `charges` mis-shows "FOV 0%". Flag when the ₹ minimum dominated.
      const byMin = (invVal * fovPct) / 100 < fovMin;
      lines.push({ head: byMin ? `FOV (min ₹${fovMin})` : `FOV ${fovPct}% on ₹${invVal}`, amount: fov });
    }
    if (oda > 0) lines.push({ head: odaLabel, amount: oda });
    if (awb > 0) lines.push({ head: 'Airwaybill charges', amount: awb });
    if (emergency > 0) lines.push({ head: 'Emergency surcharge', amount: emergency });
    if (environment > 0) lines.push({ head: 'Environmental surcharge', amount: environment });
    if (handling > 0) lines.push({ head: 'Handling', amount: handling });
    if (osp > 0) lines.push({ head: 'OSP (oversize)', amount: osp });
    if (topay > 0) lines.push({ head: 'To-Pay charge', amount: topay });
    if (appt > 0) lines.push({ head: 'Appointment delivery', amount: appt });
    if (loading > 0) lines.push({ head: 'Loading', amount: loading });
    if (unloading > 0) lines.push({ head: 'Unloading', amount: unloading });
    if (docket > 0) lines.push({ head: 'Docket', amount: docket });
    for (const cl of customLines) lines.push(cl);
    const subtotal = r2(freight + fuel + fov + oda + awb + emergency + environment + handling + osp + topay + appt + loading + unloading + docket + customTotal);
    return {
      chargeableKg, freight, fuel, fov, oda, docket, handling, topay, appt, loading, unloading,
      awb, emergency, environment, osp,
      subtotal, lines, basis: `card ${card.network}/${card.product} — ${priced.basis}`,
    };
  }

  /**
   * Resolve charges for a shipment: manual override > FTL flat rate >
   * customer rate card (revamped) > legacy weight-slab tariff > per-kg card.
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

    // 3) Revamped CustomerRateCard (network × product) — the primary tariff
    const cardBreakup = await this.chargesFromRateCard(shipment, pieces as any[]);
    if (cardBreakup) return cardBreakup;

    // 4) Legacy weight-slab tariff (ClientRateSlab) — fallback for un-migrated data
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
