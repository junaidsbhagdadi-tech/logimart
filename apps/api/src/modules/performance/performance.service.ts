import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LaneTat } from '../../common/lane-tat';
import { pinRows, placeName } from '../../common/place-name';

/**
 * Performance engine (#13-4). One computation, two views:
 *  - INTERNAL carrier / vendor-wise: booked, delivered, on-time %, average transit days, NDR %, RTO %, cost per kg,
 *    plus shipping patterns (region / city / pincode) and the weekly trend.
 *  - CUSTOMER "Performance dashboard": the same numbers for their own shipments, unified — no carrier names.
 * On-time uses the SLA rule (carrier ZONE_TAT standard; only deliveries with a real delivered date are measured;
 * appointment deliveries excluded), so every screen agrees with the SLA report.
 *
 * Priority carrier setting: how the carrier suggestion at booking ranks carriers — by price, transit time,
 * performance (on-time %), or a weighted balance of the three.
 */
export type PriorityBasis = 'BALANCED' | 'PRICE' | 'TAT' | 'PERFORMANCE';
export type PrioritySetting = { basis: PriorityBasis; weights: { price: number; tat: number; performance: number } };
const DEFAULT_PRIORITY: PrioritySetting = { basis: 'BALANCED', weights: { price: 40, tat: 30, performance: 30 } };

type Agg = { booked: number; delivered: number; measured: number; onTime: number; tatSum: number; ndr: number; rto: number; open: number; kg: number; sell: number; cost: number; costKg: number };
const blank = (): Agg => ({ booked: 0, delivered: 0, measured: 0, onTime: 0, tatSum: 0, ndr: 0, rto: 0, open: 0, kg: 0, sell: 0, cost: 0, costKg: 0 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class PerformanceService {
  private static scoreCache: { at: number; m: Map<string, { onTimePct: number | null; measured: number; avgTat: number | null }> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string) {
    const ok = (d?: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const t = ok(to) ? String(to) : today;
    const f = ok(from) ? String(from) : new Date(Date.parse(`${t}T00:00:00Z`) - 29 * 864e5).toISOString().slice(0, 10);
    if (Date.parse(t) - Date.parse(f) > 186 * 864e5) throw new BadRequestException('Pick at most 6 months.');
    return { from: f, to: t, gte: new Date(`${f}T00:00:00+05:30`), lte: new Date(`${t}T23:59:59.999+05:30`) };
  }

  /** Accounts a portal login sees: its own, plus its child accounts when it is the parent (head office). */
  async portalClientIds(clientId: bigint) {
    const kids = await this.prisma.b2bClient.findMany({ where: { parentAccountId: clientId }, select: { id: true } });
    return [clientId, ...kids.map((k) => k.id)];
  }

  async dashboard(opts: { from?: string; to?: string; clientIds?: bigint[] | null; vendor?: string; internal: boolean }) {
    const rg = this.range(opts.from, opts.to);
    const where: any = { createdAt: { gte: rg.gte, lte: rg.lte }, OR: [{ statusCode: null }, { statusCode: { not: 'CAN' } }] };
    if (opts.clientIds) where.clientId = { in: opts.clientIds };
    if (opts.internal && opts.vendor) where.vendor = { equals: opts.vendor, mode: 'insensitive' };
    const ships = await this.prisma.shipment.findMany({
      where, take: 60000,
      select: { id: true, awb: true, vendor: true, product: true, serviceMode: true, createdAt: true, statusCode: true, statusAt: true, apptDelivery: true,
        shipperPincode: true, destPincode: true, destZone: true, consigneeCity: true, consigneeName: true, bdHandedAt: true, chargeWeight: true, bdStatus: true },
    });
    const tat = new LaneTat(this.prisma);
    const zones = await tat.pinZones(ships.flatMap((s) => [s.shipperPincode, s.destPincode]));
    const pins = await pinRows(this.prisma, ships.map((s) => s.destPincode));
    // Sell + vendor cost from the report price cache (internal view only).
    const price = new Map<string, { sell: number; cost: number | null }>();
    if (opts.internal) {
      const ids = ships.map((s) => s.id);
      for (let i = 0; i < ids.length; i += 5000) {
        for (const p of await this.prisma.shipmentPrice.findMany({ where: { shipmentId: { in: ids.slice(i, i + 5000) } }, select: { shipmentId: true, subtotal: true, vendorCost: true } })) {
          price.set(String(p.shipmentId), { sell: Number(p.subtotal), cost: p.vendorCost == null ? null : Number(p.vendorCost) });
        }
      }
    }
    const vendors = opts.internal ? await this.prisma.vendor.findMany({ select: { vendorCode: true, name: true } }) : [];
    const vName = (key: string) => (key === 'BDR' ? 'BlueDart (all accounts)' : key === 'SELF' ? 'Own network (LOGM / self)' : vendors.find((v) => String(v.vendorCode).toUpperCase() === key)?.name ?? key);

    const all = blank();
    const byVendor = new Map<string, Agg>();
    const byRegion = new Map<string, Agg>(), byCity = new Map<string, Agg>(), byPin = new Map<string, Agg & { city: string }>();
    const byWeek = new Map<string, Agg>();
    const ndrList: any[] = [];
    const add = (m: Map<string, any>, k: string, extra: object = {}) => { let g = m.get(k); if (!g) { g = { ...blank(), ...extra }; m.set(k, g); } return g as Agg; };

    for (const s of ships) {
      const key = await tat.carrierKey(s.vendor);
      const code = String(s.statusCode || 'MAN');
      const surface = LaneTat.isSurfaceProduct(s.product) || /ROAD|RAIL|SURFACE/i.test(String(s.serviceMode ?? ''));
      const dz = LaneTat.zone(zones.get(String(s.destPincode)), surface);
      let onTime: boolean | null = null; let days: number | null = null;
      if (code === 'DLD' && s.statusAt && !s.apptDelivery && LaneTat.measurable(key, s)) {
        const d = LaneTat.days(s.createdAt, s.statusAt);
        const std = d >= 0 ? await tat.standardTat(key, surface ? 'SURFACE' : 'APEX', LaneTat.zone(zones.get(String(s.shipperPincode)), surface), dz) : null;
        if (d >= 0) days = d;
        if (std && d >= 0) onTime = d <= std;
      }
      const city = placeName(s.consigneeCity, pins.get(String(s.destPincode || '')), s.destZone) || '—';
      const region = String(s.destZone || dz || '—').toUpperCase();
      const ist = new Date(+s.createdAt + 330 * 60000);
      const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
      const pr = price.get(String(s.id));
      const kg = Number(s.chargeWeight || 0);
      const groups = [all, add(byRegion, region), add(byCity, city), add(byPin, String(s.destPincode || '—'), { city }), add(byWeek, monday), ...(opts.internal ? [add(byVendor, key)] : [])];
      for (const g of groups) {
        g.booked++; g.kg += kg;
        if (code === 'DLD') g.delivered++;
        else if (code === 'UDL') g.ndr++;
        else if (code === 'RTO' || code === 'RTD') g.rto++;
        else g.open++;
        if (onTime != null) { g.measured++; if (onTime) g.onTime++; }
        if (days != null && onTime != null) g.tatSum += days;
        if (pr) { g.sell += pr.sell; if (pr.cost != null) { g.cost += pr.cost; g.costKg += kg; } }
      }
      if (code === 'UDL' && ndrList.length < 300) {
        ndrList.push({ awb: s.awb, bookedAt: s.createdAt, consignee: s.consigneeName ?? '', city, pincode: s.destPincode ?? '', reason: s.bdStatus ?? 'Undelivered', ...(opts.internal ? { vendor: vName(key) } : {}) });
      }
    }
    const out = (g: Agg) => ({
      booked: g.booked, delivered: g.delivered, deliveredPct: pct(g.delivered, g.booked), measured: g.measured, onTimePct: pct(g.onTime, g.measured),
      avgTatDays: g.measured ? r2(g.tatSum / g.measured) : null, ndr: g.ndr, ndrPct: pct(g.ndr, g.booked), rto: g.rto, rtoPct: pct(g.rto, g.booked), open: g.open,
      ...(opts.internal ? { sell: r2(g.sell), cost: r2(g.cost), costPerKg: g.costKg ? r2(g.cost / g.costKg) : null, sellPerKg: g.kg ? r2(g.sell / g.kg) : null } : {}),
    });
    const top = (m: Map<string, any>, n: number, label: string) => [...m.entries()].sort((a, b) => b[1].booked - a[1].booked).slice(0, n).map(([k, g]) => ({ [label]: k, ...(g.city && label === 'pincode' ? { city: g.city } : {}), ...out(g) }));
    return {
      from: rg.from, to: rg.to, kpis: out(all),
      ...(opts.internal ? { byVendor: [...byVendor.entries()].sort((a, b) => b[1].booked - a[1].booked).map(([k, g]) => ({ vendor: k, name: vName(k), ...out(g) })) } : {}),
      byRegion: top(byRegion, 30, 'region'), byCity: top(byCity, 20, 'city'), byPincode: top(byPin, 20, 'pincode'),
      trend: [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, g]) => ({ week, ...out(g) })),
      ndr: ndrList,
    };
  }

  // ---- priority carrier setting ----

  async getPriority(): Promise<PrioritySetting> {
    const r = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'CARRIER_PRIORITY', code: 'DEFAULT' } } }).catch(() => null);
    const a: any = r?.attrs ?? {};
    const basis: PriorityBasis = ['BALANCED', 'PRICE', 'TAT', 'PERFORMANCE'].includes(a.basis) ? a.basis : DEFAULT_PRIORITY.basis;
    const w = a.weights ?? {};
    return { basis, weights: { price: Number(w.price ?? DEFAULT_PRIORITY.weights.price), tat: Number(w.tat ?? DEFAULT_PRIORITY.weights.tat), performance: Number(w.performance ?? DEFAULT_PRIORITY.weights.performance) } };
  }

  async setPriority(dto: Partial<PrioritySetting>) {
    const cur = await this.getPriority();
    const basis = (['BALANCED', 'PRICE', 'TAT', 'PERFORMANCE'] as const).includes(dto.basis as any) ? (dto.basis as PriorityBasis) : cur.basis;
    const w = { ...cur.weights, ...(dto.weights ?? {}) };
    for (const k of ['price', 'tat', 'performance'] as const) { w[k] = Math.max(0, Math.min(100, Math.round(Number(w[k]) || 0))); }
    if (basis === 'BALANCED' && w.price + w.tat + w.performance === 0) throw new BadRequestException('Give at least one weight above 0.');
    const attrs = { basis, weights: w };
    await this.prisma.masterEntry.upsert({
      where: { type_code: { type: 'CARRIER_PRIORITY', code: 'DEFAULT' } },
      update: { attrs, name: 'Carrier priority' }, create: { type: 'CARRIER_PRIORITY', code: 'DEFAULT', name: 'Carrier priority', attrs },
    });
    return attrs;
  }

  /** On-time % / transit per carrier key over the last 60 days (cached 1 h) — feeds the carrier suggestion. */
  async carrierScores() {
    if (PerformanceService.scoreCache && Date.now() - PerformanceService.scoreCache.at < 3600_000) return PerformanceService.scoreCache.m;
    const to = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - 59 * 864e5 + 330 * 60000).toISOString().slice(0, 10);
    const d: any = await this.dashboard({ from, to, internal: true });
    const m = new Map<string, { onTimePct: number | null; measured: number; avgTat: number | null }>();
    for (const v of d.byVendor ?? []) m.set(v.vendor, { onTimePct: v.onTimePct, measured: v.measured, avgTat: v.avgTatDays });
    PerformanceService.scoreCache = { at: Date.now(), m };
    return m;
  }

  /**
   * Rank carrier options by the priority setting. Each option: { price, tatDays, onTimePct, serviceable }.
   * Non-serviceable always last. BALANCED = weighted score of normalised price (cheaper better), transit
   * (faster better) and on-time % (higher better); a missing number scores as the worst of the set.
   */
  rank<T extends { price: number | null; tatDays: number | null; onTimePct: number | null; serviceable: boolean | null }>(rows: T[], p: PrioritySetting): (T & { priorityScore: number | null; priorityRank: number })[] {
    const vals = (f: (r: T) => number | null) => rows.map(f).filter((x): x is number => x != null);
    const norm = (v: number | null, list: number[], lowerBetter: boolean) => {
      if (!list.length) return 0;
      const lo = Math.min(...list), hi = Math.max(...list);
      if (v == null) return 0;
      if (hi === lo) return 1;
      return lowerBetter ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
    };
    const P = vals((r) => r.price), T = vals((r) => r.tatDays), O = vals((r) => r.onTimePct);
    const w = p.basis === 'PRICE' ? { price: 1, tat: 0.001, performance: 0.001 } : p.basis === 'TAT' ? { price: 0.001, tat: 1, performance: 0.001 } : p.basis === 'PERFORMANCE' ? { price: 0.001, tat: 0.001, performance: 1 } : p.weights;
    const tot = (w.price + w.tat + w.performance) || 1;
    const scored = rows.map((r) => ({ ...r, priorityScore: Math.round(((w.price * norm(r.price, P, true) + w.tat * norm(r.tatDays, T, true) + w.performance * norm(r.onTimePct, O, false)) / tot) * 100) }));
    scored.sort((a, b) => (a.serviceable === false ? 1 : 0) - (b.serviceable === false ? 1 : 0) || b.priorityScore - a.priorityScore);
    return scored.map((r, i) => ({ ...r, priorityRank: i + 1 }));
  }
}
