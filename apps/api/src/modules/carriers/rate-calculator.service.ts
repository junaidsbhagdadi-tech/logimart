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

  /** Vendor "family": every BlueDart account code + BDR count as one carrier for history. */
  private async familyOf(code: string): Promise<string[]> {
    const vendors = await this.prisma.vendor.findMany({ select: { vendorCode: true, name: true } });
    const isBd = (c: string | null, n: string | null) => /^BDR$/i.test(c ?? '') || /^(BDR|BD )|BLUE ?DART/i.test(n ?? '');
    const me = vendors.find((v) => String(v.vendorCode).toUpperCase() === code.toUpperCase());
    if (me ? isBd(me.vendorCode, me.name) : code.toUpperCase() === 'BDR') return vendors.filter((v) => isBd(v.vendorCode, v.name)).map((v) => String(v.vendorCode).toUpperCase());
    return [code.toUpperCase()];
  }

  /** Delivered shipments of the last 90 days, grouped vendor × product × destination zone (cached 30 min). */
  private async history() {
    if (this.statsCache && Date.now() - this.statsCache.at < 30 * 60_000) return this.statsCache.rows;
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT upper(coalesce(vendor,'')) AS vendor, upper(coalesce(product,'')) AS product, upper(coalesce("destZone",'')) AS zone,
             count(*)::int AS measured,
             sum(CASE WHEN "statusAt" <= date_trunc('day', "expectedDelivery") + interval '1 day' THEN 1 ELSE 0 END)::int AS ontime,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("statusAt" - "createdAt")) / 86400.0) AS median_days
      FROM shipments
      WHERE "statusCode" = 'DLD' AND "statusAt" >= now() - interval '${HISTORY_DAYS} days'
        AND "expectedDelivery" IS NOT NULL AND "expectedDelivery" >= "createdAt" - interval '1 day'
        AND coalesce("apptDelivery", false) = false
      GROUP BY 1, 2, 3`);
    this.statsCache = { at: Date.now(), rows };
    return rows;
  }

  private async stat(code: string, product: string, zone: string): Promise<Stat> {
    const fam = new Set(await this.familyOf(code));
    const rows = (await this.history()).filter((r) => fam.has(r.vendor) && r.product === product);
    const agg = (list: any[]) => {
      const measured = list.reduce((s, r) => s + r.measured, 0);
      const ontime = list.reduce((s, r) => s + r.ontime, 0);
      const days = measured ? list.reduce((s, r) => s + Number(r.median_days || 0) * r.measured, 0) / measured : null;
      return { measured, onTimePct: measured ? Math.round((ontime / measured) * 1000) / 10 : null, transitDays: days != null ? Math.max(1, Math.ceil(days)) : null };
    };
    const lane = agg(rows.filter((r) => r.zone === String(zone).toUpperCase()));
    if (lane.measured >= MIN_SAMPLE) return { ...lane, scope: 'lane' };
    const all = agg(rows);
    if (all.measured > 0) return { ...all, scope: 'vendor' };
    return { onTimePct: null, measured: 0, transitDays: null, scope: null };
  }

  // ------------------------------------------------------------------ internal

  async internal(dto: CalcInput) {
    const p = await this.prepare(dto);
    const vendorsMaster = await this.prisma.vendor.findMany({ where: { isActive: true }, select: { vendorCode: true, name: true } });
    const nameOf = (c: string) => vendorsMaster.find((v) => String(v.vendorCode).toUpperCase() === c)?.name ?? c;
    const carded = await this.rates.vendorsWithCostCard(p.product);
    // also list carriers that carried this product recently but have no cost card, so the gap is visible
    const hist = await this.history();
    const recent = [...new Set(hist.filter((r) => r.product === p.product && r.measured >= 5 && r.vendor).map((r) => r.vendor))];
    const codes = [...new Set([...carded.map((c) => c.code), ...recent])].filter((c) => c && c !== 'SELF' && c !== 'LOGM');
    const clientId = dto.clientId != null && /^\d+$/.test(String(dto.clientId)) ? BigInt(String(dto.clientId)) : null;

    const rows = await Promise.all(codes.map(async (code) => {
      const cov = await this.pincodes.vendorOda(p.base.destPincode, code, p.product).catch(() => null);
      const notServiceable = !!cov?.known && !cov.serviceable;
      const ship = { ...p.base, vendor: code, clientId: null, isOda: cov?.known ? cov.isOda : p.base.isOda };
      const card = await this.rates.vendorCostCard(code, p.product);
      const cost = card && !notServiceable ? await this.rates.priceWithCard(card, ship, p.pieces).catch(() => null) : null;
      const st = await this.stat(code, p.product, p.base.destZone);
      let customer: any = null;
      if (clientId && !notServiceable) {
        const sell = await this.rates.chargesForShipment({ ...ship, clientId }, p.pieces).catch(() => null);
        if (sell) { const m = this.money(sell); customer = { ...m, margin: cost ? r2(m.subtotal - Number(cost.subtotal)) : null, marginPct: cost && m.subtotal ? Math.round(((m.subtotal - Number(cost.subtotal)) / m.subtotal) * 1000) / 10 : null }; }
      }
      return {
        vendor: code, name: nameOf(code), serviceable: notServiceable ? false : cov?.known ? true : null, oda: cov?.known ? cov.isOda : p.base.isOda,
        cost: cost ? this.money(cost) : null,
        status: notServiceable ? 'Not serviceable' : !card ? 'No rate card' : !cost ? 'No rate for this lane' : 'ok',
        transitDays: st.transitDays ?? p.masterTatDays, transitSource: st.transitDays ? 'history' : p.masterTatDays ? 'pincode master' : null,
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
    const st = await this.stat(vendor === 'SELF' ? 'LOGM' : vendor, p.product, p.base.destZone);
    return {
      route: p.route, weight: p.weight, carrier: vendor, serviceable: true, oda: cov?.known ? cov.isOda : p.base.isOda,
      price: this.money(sell), transitDays: st.transitDays ?? p.masterTatDays, onTimePct: st.onTimePct, measured: st.measured,
    };
  }
}
