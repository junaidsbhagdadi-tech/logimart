import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RateService } from '../billing/rate.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { PincodesService } from '../pincodes/pincodes.service';

const GST = 0.18;
const HISTORY_DAYS = 90;
const MIN_SAMPLE = 20; // below this, a lane's on-time % falls back to the vendor × product nationally
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type CalcBox = { count?: number; kg?: number; l?: number; w?: number; h?: number };
export type CalcInput = {
  originPincode: string; destPincode: string; product: string;
  boxes: CalcBox[]; paymentTerm?: 'PREPAID' | 'TO_PAY'; invoiceValue?: number; docType?: 'NDOX' | 'DOX';
  isDod?: boolean; dodAmount?: number; apptDelivery?: boolean; ftlVehicleType?: string;
  clientId?: number | string; vendor?: string;
};
type Stat = { onTimePct: number | null; measured: number; transitDays: number | null; scope: 'lane' | 'vendor' | null };

/**
 * Rate calculator. INTERNAL: every vendor's OWN cost card, fully priced (freight + every accessorial the
 * card carries) — lowest first — with transit time and on-time % from our delivery history; optionally the
 * chosen customer's contract price + margin beside each. PORTAL: only for customers switched on
 * (canCheckRates), only their contract carriers, priced on their contract.
 */
@Injectable()
export class RateCalculatorService {
  private statsCache: { at: number; rows: any[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RateService,
    private readonly shipments: ShipmentsService,
    private readonly pincodes: PincodesService,
  ) {}

  // ------------------------------------------------------------------ shared input → shipment

  private async prepare(dto: CalcInput) {
    const o = String(dto.originPincode ?? '').trim(), d = String(dto.destPincode ?? '').trim();
    if (!/^\d{6}$/.test(o)) throw new BadRequestException('Enter the 6-digit origin pincode.');
    if (!/^\d{6}$/.test(d)) throw new BadRequestException('Enter the 6-digit destination pincode.');
    const product = String(dto.product ?? '').trim().toUpperCase();
    if (!product) throw new BadRequestException('Choose a product.');
    const boxes = (dto.boxes ?? []).map((b) => ({ count: Math.max(1, Math.floor(Number(b.count) || 1)), kg: Number(b.kg) || 0, l: Number(b.l) || 0, w: Number(b.w) || 0, h: Number(b.h) || 0 }));
    if (!boxes.length || boxes.some((b) => !(b.kg > 0))) throw new BadRequestException('Enter the weight of every box (kg, more than 0).');
    if (dto.isDod && !(Number(dto.dodAmount) > 0)) throw new BadRequestException('DOD is ticked — enter the cheque / DD amount.');

    const [originPin, destPin, pm] = await Promise.all([
      this.prisma.pincode.findUnique({ where: { pincode: o } }),
      this.prisma.pincode.findUnique({ where: { pincode: d } }),
      this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'PRODUCT', code: product } } }).catch(() => null),
    ]);
    const group = String((pm?.attrs as any)?.groupType ?? '');
    const surface = /SURF|ROAD|RAIL|TRAIN/i.test(group) || ['SFC', 'TOSFC', 'SURFACE', 'HUB', 'FTL'].includes(product);
    const serviceMode = product === 'FTL' || dto.ftlVehicleType ? 'ROAD_FTL' : surface ? 'ROAD_PTL' : 'AIR_EXPRESS';
    const originZone = this.shipments.productZone(originPin, product, serviceMode, o, 'SOUTH') || 'SOUTH';
    const destZone = this.shipments.productZone(destPin, product, serviceMode, d, 'SOUTH') || 'SOUTH';
    const masterOda = !!destPin && (destPin.isOda || String(destPin.edl ?? 'Regular').toUpperCase() !== 'REGULAR');

    // One piece per box; volumetric at the default rule (air ÷5000; surface 6 CFT) — a card that sets its
    // own divisor / CFT recomputes it from the dimensions.
    const pieces = boxes.flatMap((b) => Array.from({ length: b.count }, () => ({
      deadKg: b.kg, lengthCm: b.l || null, widthCm: b.w || null, heightCm: b.h || null, status: 'BOOKED',
      volKg: b.l && b.w && b.h ? +(surface ? (b.l * b.w * b.h / 27000) * 6 : (b.l * b.w * b.h) / 5000).toFixed(3) : 0,
    })));
    const invoiceValue = Number(dto.invoiceValue) || 0;
    const base: any = {
      product, serviceMode, originZone, destZone, originPincode: o, destPincode: d, shipperPincode: o, consigneeCity: destPin?.city ?? null,
      declaredValue: invoiceValue, shipmentValue: invoiceValue, docType: dto.docType === 'DOX' ? 'DOX' : 'NDOX',
      paymentTerm: dto.paymentTerm === 'TO_PAY' ? 'TO_PAY' : 'PREPAID', isDod: !!dto.isDod, dodAmount: dto.isDod ? Number(dto.dodAmount) : null,
      apptDelivery: !!dto.apptDelivery, ftlVehicleType: dto.ftlVehicleType || null, pieceCount: pieces.length, isOda: masterOda, createdAt: new Date(),
    };
    const dead = pieces.reduce((s, p) => s + p.deadKg, 0), vol = pieces.reduce((s, p) => s + p.volKg, 0);
    return {
      base, pieces, product, surface,
      route: {
        origin: { pincode: o, city: originPin?.city ?? null, state: originPin?.state ?? null, known: !!originPin, zone: originZone },
        dest: { pincode: d, city: destPin?.city ?? null, state: destPin?.state ?? null, known: !!destPin, zone: destZone, oda: masterOda },
      },
      weight: { boxes: pieces.length, deadKg: r2(dead), volKg: r2(vol), volRule: surface ? 'surface 6 CFT' : 'air ÷5000' },
      masterTatDays: destPin?.tatHours ? Math.ceil(destPin.tatHours / 24) : null,
    };
  }

  private money(b: any) {
    const subtotal = r2(b.subtotal);
    const gst = r2(subtotal * GST);
    return { chargeableKg: b.chargeableKg, lines: (b.lines ?? []).map((l: any) => ({ head: l.head, amount: r2(l.amount) })), subtotal, gst, total: r2(subtotal + gst), collectOnDelivery: r2(b.collectOnDelivery ?? 0) };
  }

  // ------------------------------------------------------------------ history: on-time % + transit days

  private vendorsCache: { at: number; rows: { vendorCode: string | null; name: string }[] } | null = null;
  private async vendorList() {
    if (!this.vendorsCache || Date.now() - this.vendorsCache.at > 10 * 60_000) this.vendorsCache = { at: Date.now(), rows: await this.prisma.vendor.findMany({ select: { vendorCode: true, name: true } }) };
    return this.vendorsCache!.rows;
  }
  private static isBd(c?: string | null, n?: string | null) { return /^BDR$/i.test(c ?? '') || /^(BDR|BD )|BLUE ?DART/i.test(n ?? ''); }

  /** Carrier key for history + transit tables: every BlueDart account code (and BDR) is one carrier "BDR". */
  private async carrierKey(code: string): Promise<string> {
    const c = String(code ?? '').toUpperCase();
    if (!c || c === 'SELF' || c === 'LOGM') return 'SELF';
    const v = (await this.vendorList()).find((x) => String(x.vendorCode).toUpperCase() === c);
    return RateCalculatorService.isBd(v?.vendorCode ?? c, v?.name) ? 'BDR' : c;
  }

  /** The carrier's STANDARD transit days for a lane — the ZONE_TAT matrix <CARRIER>__<MODE>, else SELF__<MODE>. */
  private tatMatrices: { at: number; m: Map<string, any> } | null = null;
  private async standardTat(carrier: string, mode: string, oz?: string | null, dz?: string | null): Promise<number | null> {
    if (!oz || !dz) return null;
    if (!this.tatMatrices || Date.now() - this.tatMatrices.at > 30 * 60_000) {
      const rows = await this.prisma.masterEntry.findMany({ where: { type: 'ZONE_TAT' }, select: { code: true, attrs: true } });
      this.tatMatrices = { at: Date.now(), m: new Map(rows.map((r) => [r.code.toUpperCase(), (r.attrs as any)?.matrix ?? {}])) };
    }
    for (const code of [`${carrier}__${mode}`, `SELF__${mode}`, mode]) {
      const d = Number(this.tatMatrices.m.get(code)?.[oz]?.[dz]);
      if (d > 0) return d;
    }
    return null;
  }

  /**
   * Trusted deliveries of the last 90 days: carrier, product, lane zones (from the pincodes, per mode) and the
   * days taken. BlueDart's delivered date is BlueDart's own scan date, so all of it counts; other carriers record
   * "delivered" when our sync sees it, which is only true for live-tracked bookings — so only their recent
   * bookings delivered within 20 days count (older back-filled imports are left out). Cached 30 min.
   */
  private async history() {
    if (this.statsCache && Date.now() - this.statsCache.at < 30 * 60_000) return this.statsCache.rows;
    const raw = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT upper(coalesce(s.vendor,'')) AS vendor, upper(coalesce(s.product,'')) AS product,
             replace(upper(coalesce(o."surfaceZone",'')),' ','') AS osz, replace(upper(coalesce(d."surfaceZone",'')),' ','') AS dsz,
             replace(upper(coalesce(o."apexZone",'')),' ','') AS oaz, replace(upper(coalesce(d."apexZone",'')),' ','') AS daz,
             (date(s."statusAt" + interval '330 minutes') - date(s."createdAt" + interval '330 minutes'))::int AS days,
             (s."createdAt" >= now() - interval '45 days') AS recent
      FROM shipments s
      LEFT JOIN pincodes o ON o.pincode = s."shipperPincode"
      LEFT JOIN pincodes d ON d.pincode = s."destPincode"
      WHERE s."statusCode" = 'DLD' AND s."statusAt" >= now() - interval '${HISTORY_DAYS} days' AND coalesce(s."apptDelivery", false) = false`);
    const rows: any[] = [];
    for (const r of raw) {
      if (r.days == null || r.days < 0 || r.days > 45) continue;
      const key = await this.carrierKey(r.vendor);
      const trusted = key === 'BDR' ? true : r.recent && r.days <= 20;
      if (!trusted) continue;
      const surface = ['SFC', 'TOSFC', 'SURFACE', 'HUB', 'FTL'].includes(r.product);
      const oz = (surface ? r.osz : r.oaz) || null, dz = (surface ? r.dsz : r.daz) || null;
      const std = await this.standardTat(key, surface ? 'SURFACE' : 'APEX', oz, dz);
      rows.push({ key, product: r.product, oz, dz, days: Math.max(1, r.days), std });
    }
    this.statsCache = { at: Date.now(), rows };
    return rows;
  }

  /** On-time % (delivered within the carrier's standard days for that lane) + typical actual days. Lane first;
   *  under 20 deliveries it widens to the carrier × product on all lanes. Carrier 'SELF' = every carrier. */
  private async stat(code: string, product: string, oz: string | null, dz: string | null): Promise<Stat & { actualDays: number | null }> {
    const key = await this.carrierKey(code);
    const all = (await this.history()).filter((r) => (key === 'SELF' || r.key === key) && r.product === product);
    const agg = (list: any[]) => {
      const withStd = list.filter((r) => r.std);
      const sorted = list.map((r) => r.days).sort((x, y) => x - y);
      return {
        measured: withStd.length,
        onTimePct: withStd.length ? Math.round((withStd.filter((r) => r.days <= r.std).length / withStd.length) * 1000) / 10 : null,
        actualDays: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      };
    };
    const lane = agg(all.filter((r) => r.oz === oz && r.dz === dz));
    if (lane.measured >= MIN_SAMPLE) return { ...lane, transitDays: null, scope: 'lane' };
    const wide = agg(all);
    if (wide.measured > 0) return { ...wide, transitDays: null, scope: 'vendor' };
    return { onTimePct: null, measured: 0, transitDays: null, actualDays: lane.actualDays ?? wide.actualDays, scope: null };
  }

  /** Lane zones for the TAT tables (surface → surfaceZone, else apexZone). */
  private async laneZones(o: string, d: string, surface: boolean) {
    const [po, pd] = await Promise.all([this.prisma.pincode.findUnique({ where: { pincode: o } }), this.prisma.pincode.findUnique({ where: { pincode: d } })]);
    const z = (p: any) => { const v = surface ? p?.surfaceZone : p?.apexZone; return v ? String(v).replace(/\s+/g, '').toUpperCase() : null; };
    return { oz: z(po), dz: z(pd) };
  }

  // ------------------------------------------------------------------ internal

  async internal(dto: CalcInput) {
    const p = await this.prepare(dto);
    const vendorsMaster = await this.prisma.vendor.findMany({ where: { isActive: true }, select: { vendorCode: true, name: true } });
    const nameOf = (c: string) => vendorsMaster.find((v) => String(v.vendorCode).toUpperCase() === c)?.name ?? c;
    const carded = await this.rates.vendorsWithCostCard(p.product);
    // also list carriers that carried this product recently but have no cost card, so the gap is visible
    const hist = await this.history();
    const counts = new Map<string, number>();
    for (const r of hist) if (r.product === p.product && r.key !== 'SELF') counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
    const recent = [...counts].filter(([, n]) => n >= 5).map(([k]) => k);
    const codes = [...new Set([...carded.map((c) => c.code), ...recent])].filter((c) => c && c !== 'SELF' && c !== 'LOGM');
    const clientId = dto.clientId != null && /^\d+$/.test(String(dto.clientId)) ? BigInt(String(dto.clientId)) : null;
    const lz = await this.laneZones(p.base.originPincode, p.base.destPincode, p.surface);

    const rows = await Promise.all(codes.map(async (code) => {
      const cov = await this.pincodes.vendorOda(p.base.destPincode, code, p.product).catch(() => null);
      const notServiceable = !!cov?.known && !cov.serviceable;
      const ship = { ...p.base, vendor: code, clientId: null, isOda: cov?.known ? cov.isOda : p.base.isOda };
      const card = await this.rates.vendorCostCard(code, p.product);
      const cost = card && !notServiceable ? await this.rates.priceWithCard(card, ship, p.pieces).catch(() => null) : null;
      const key = await this.carrierKey(code);
      const std = await this.standardTat(key, p.surface ? 'SURFACE' : 'APEX', lz.oz, lz.dz);
      const st = await this.stat(code, p.product, lz.oz, lz.dz);
      let customer: any = null;
      if (clientId && !notServiceable) {
        const sell = await this.rates.chargesForShipment({ ...ship, clientId }, p.pieces).catch(() => null);
        if (sell) { const m = this.money(sell); customer = { ...m, margin: cost ? r2(m.subtotal - Number(cost.subtotal)) : null, marginPct: cost && m.subtotal ? Math.round(((m.subtotal - Number(cost.subtotal)) / m.subtotal) * 1000) / 10 : null }; }
      }
      return {
        vendor: code, name: nameOf(code), serviceable: notServiceable ? false : cov?.known ? true : null, oda: cov?.known ? cov.isOda : p.base.isOda,
        cost: cost ? this.money(cost) : null,
        status: notServiceable ? 'Not serviceable' : !card ? 'No rate card' : !cost ? 'No rate for this lane' : 'ok',
        transitDays: std ?? p.masterTatDays, transitSource: std ? 'carrier standard' : p.masterTatDays ? 'pincode master' : null, actualDays: st.actualDays,
        onTimePct: st.onTimePct, measured: st.measured, statScope: st.scope, customer,
      };
    }));
    rows.sort((a, b) => (a.cost ? 0 : 1) - (b.cost ? 0 : 1) || (a.serviceable === false ? 1 : 0) - (b.serviceable === false ? 1 : 0) || (a.cost?.total ?? 1e12) - (b.cost?.total ?? 1e12));
    const priced = rows.filter((r) => r.cost);
    const tag = (r: any) => [
      priced.length && r === priced.reduce((m, x) => (x.cost!.total < m.cost!.total ? x : m)) ? 'Lowest' : null,
      priced.some((x) => x.transitDays) && r.cost && r.transitDays === Math.min(...priced.filter((x) => x.transitDays).map((x) => x.transitDays!)) ? 'Fastest' : null,
      priced.some((x) => x.measured >= MIN_SAMPLE) && r.cost && r.measured >= MIN_SAMPLE && r.onTimePct === Math.max(...priced.filter((x) => x.measured >= MIN_SAMPLE).map((x) => x.onTimePct ?? 0)) ? 'Most reliable' : null,
    ].filter(Boolean);
    return { route: p.route, weight: p.weight, product: p.product, rows: rows.map((r) => ({ ...r, tags: tag(r) })) };
  }

  // ------------------------------------------------------------------ customer portal

  private async portalClient(clientId: bigint) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: clientId }, select: { canCheckRates: true, allowedVendors: true, legalName: true } });
    if (!c?.canCheckRates) throw new ForbiddenException('The rate calculator is not enabled for your account. Please contact us.');
    return c;
  }

  /** Products + carriers the customer may price: products with an active contract card; carriers = their
   *  assigned carriers (or our network when none are assigned). */
  async portalOptions(clientId: bigint) {
    const c = await this.portalClient(clientId);
    const now = new Date();
    const cards = await this.prisma.customerRateCard.findMany({
      where: { clientId, isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
      select: { product: true },
    });
    const products = [...new Set(cards.map((x) => String(x.product).toUpperCase()))];
    const masters = await this.prisma.masterEntry.findMany({ where: { type: 'PRODUCT', code: { in: products } }, select: { code: true, name: true } });
    const vendorsMaster = await this.prisma.vendor.findMany({ select: { vendorCode: true, name: true } });
    const codes = (Array.isArray(c.allowedVendors) ? c.allowedVendors : []).map((x) => String(x).toUpperCase());
    return {
      customer: c.legalName,
      products: products.map((code) => ({ code, name: masters.find((m) => m.code.toUpperCase() === code)?.name ?? code })),
      carriers: codes.length ? codes.map((code) => ({ code, name: vendorsMaster.find((v) => String(v.vendorCode).toUpperCase() === code)?.name ?? code })) : [{ code: 'SELF', name: 'Our network' }],
    };
  }

  async portal(clientId: bigint, dto: CalcInput) {
    const opts = await this.portalOptions(clientId);
    const vendor = String(dto.vendor ?? '').trim().toUpperCase();
    if (!vendor) throw new BadRequestException('Choose a carrier.');
    if (!opts.carriers.some((c) => c.code === vendor)) throw new ForbiddenException('That carrier is not on your contract.');
    if (!opts.products.some((x) => x.code === String(dto.product ?? '').toUpperCase())) throw new BadRequestException('That product is not on your contract.');
    const p = await this.prepare(dto);
    const cov = vendor === 'SELF' ? null : await this.pincodes.vendorOda(p.base.destPincode, vendor, p.product).catch(() => null);
    if (cov?.known && !cov.serviceable) return { route: p.route, weight: p.weight, carrier: vendor, serviceable: false, message: 'This carrier does not deliver to that pincode.' };
    const sell = await this.rates.chargesForShipment({ ...p.base, clientId, vendor, isOda: cov?.known ? cov.isOda : p.base.isOda }, p.pieces).catch(() => null);
    if (!sell) return { route: p.route, weight: p.weight, carrier: vendor, serviceable: true, message: 'No contract rate for this route — please contact us for a quote.' };
    const lz = await this.laneZones(p.base.originPincode, p.base.destPincode, p.surface);
    const key = await this.carrierKey(vendor);
    const std = await this.standardTat(key, p.surface ? 'SURFACE' : 'APEX', lz.oz, lz.dz);
    const st = await this.stat(vendor, p.product, lz.oz, lz.dz);
    return {
      route: p.route, weight: p.weight, carrier: vendor, serviceable: true, oda: cov?.known ? cov.isOda : p.base.isOda,
      price: this.money(sell), transitDays: std ?? p.masterTatDays, actualDays: st.actualDays, onTimePct: st.onTimePct, measured: st.measured,
    };
  }
}
