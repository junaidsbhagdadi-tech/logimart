import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BluedartService } from '../bluedart/bluedart.service';
import { bdConfigured } from '../bluedart/bluedart.config';
import { DelhiveryService } from '../delhivery/delhivery.service';
import { delConfigured } from '../delhivery/delhivery.config';
import { XpressBeesService } from '../xpressbees/xpressbees.service';
import { isXpressBeesVendor, xbConfigured } from '../xpressbees/xpressbees.config';
import { GatiService, gatiConfigured, isGatiVendor } from '../gati/gati.service';
import { VExpressService, isVExpressVendor, vxConfigured } from '../vexpress/vexpress.service';
import { ArlService, arlConfigured } from '../arlogistics/arl.service';
import { DsCargoService, isDsCargoVendor } from '../dscargo/dscargo.service';
import { ShipmentsService } from '../shipments/shipments.service';

export type CarrierKind = 'BD' | 'DLY' | 'XB' | 'GATI' | 'VXP' | 'ARL' | 'DSC' | 'SELF' | 'OTHER';
const NAMES: Record<CarrierKind, string> = { BD: 'BlueDart', DLY: 'Delhivery', XB: 'XpressBees', GATI: 'Gati', VXP: 'V Express', ARL: 'AR Logistics', DSC: 'DS Cargo', SELF: 'own network', OTHER: 'carrier' };
const isDelhivery = (v: string) => /^DLY|DELHIVERY/i.test(v);
const isArl = (v: string) => /^ARL$|AR\s*LOG/i.test(v);
const withTimeout = <T>(p: Promise<T>, ms = 5000): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/**
 * One front door for every carrier: which integration an AWB uses (from its vendor code), hand-off,
 * tracking refresh, carrier suggestion at booking, and the auto hand-off of new bookings.
 */
@Injectable()
export class CarriersService implements OnModuleInit {
  private readonly log = new Logger('Carriers');
  private dispatching = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly bd: BluedartService,
    private readonly del: DelhiveryService,
    private readonly xb: XpressBeesService,
    private readonly gati: GatiService,
    private readonly vx: VExpressService,
    private readonly arl: ArlService,
    private readonly ds: DsCargoService,
    private readonly shipments: ShipmentsService,
  ) {}

  /**
   * Track a carrier number that is NOT booked with us ("normal tracking" for any BlueDart / DS Cargo /
   * XpressBees / Gati number). Asks the carriers whose number format fits, in parallel; every hit is
   * returned normalised: status, route, delivery, scans.
   */
  async lookup(numberRaw: string) {
    const n = String(numberRaw || '').replace(/\s+/g, '').toUpperCase();
    if (n.length < 6) throw new BadRequestException('Enter a full carrier AWB / docket number.');
    const tag = <T>(p: Promise<T>, ms = 15000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    const x = (raw: string, t: string) => ((raw.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || '').trim();
    const tries: Promise<any>[] = [];
    if (/^\d{8,12}$/.test(n)) tries.push(tag(this.bd.track(n)).then((r: any) => {
      const raw = typeof r === 'string' ? r : String(r?.raw ?? '');
      if (!/<Shipment[^>]*WaybillNo=/.test(raw) || !x(raw, 'Status')) return null;
      const scans = [...raw.matchAll(/<ScanDetail>([\s\S]*?)<\/ScanDetail>/g)].map((m) => ({ status: x(m[1], 'Scan'), date: x(m[1], 'ScanDate'), time: x(m[1], 'ScanTime'), location: x(m[1], 'ScannedLocation') }));
      return { carrier: 'BlueDart', number: n, status: x(raw, 'Status'), service: x(raw, 'Service'), origin: x(raw, 'Origin'), destination: x(raw, 'Destination'), pickedUp: x(raw, 'PickUpDate'), expected: x(raw, 'ExpectedDeliveryDate'), statusAt: `${x(raw, 'StatusDate')} ${x(raw, 'StatusTime')}`.trim(), receivedBy: x(raw, 'ReceivedBy') || null, weight: x(raw, 'Weight'), scans };
    }).catch(() => null));
    if (/^(DSE)?\d{5,9}$/.test(n)) tries.push(tag(this.ds.track(n)).then((d: any) => {
      const status = String(d?.Status || d?.status || '').trim();
      if (!status) return null;
      return { carrier: 'DS Cargo', number: /^\d/.test(n) ? `DSE${n}` : n, status, origin: d.from_city ?? '', destination: d.to_city ?? '', statusAt: d.delivery_date ?? '', receivedBy: d.receiver_name || d.POD_Remark || null, scans: [] };
    }).catch(() => null));
    if (/^\d{12,16}$/.test(n)) tries.push(tag(this.xb.track(n)).then((d: any) => {
      const body = d?.data ?? d;
      const status = String(body?.status ?? body?.current_status ?? body?.shipment_status ?? '').trim();
      if (!status || /not found|invalid/i.test(status)) return null;
      const hist: any[] = body?.history ?? body?.scans ?? body?.tracking ?? [];
      return { carrier: 'XpressBees', number: n, status, origin: body?.origin ?? '', destination: body?.destination ?? '', statusAt: body?.status_date ?? body?.updated_at ?? '', receivedBy: body?.received_by ?? null,
        scans: Array.isArray(hist) ? hist.map((h: any) => ({ status: h.status_name ?? h.status ?? h.message ?? '', date: h.status_date ?? h.date ?? h.event_time ?? '', time: '', location: h.location ?? h.city ?? '' })) : [] };
    }).catch(() => null));
    if (/^\d{9,10}$/.test(n)) tries.push(tag(this.gati.track(n)).then((r: any) => {
      const d = Array.isArray(r?.details) ? r.details[0] : r?.details;
      if (!d?.DOCKET_NUMBER || d?.errmsg) return null;
      const tl: any[] = d.TRANSIT_DTLS ?? [];
      return { carrier: 'Gati', number: n, status: d.DOCKET_STATUS || tl[0]?.INTRANSIT_STATUS || '', origin: d.BOOKING_STN ?? d.ORIGIN ?? '', destination: d.DELIVERY_STN ?? d.DESTINATION ?? '', statusAt: d.DELIVERY_DATE ?? '', receivedBy: d.RECEIVER_NAME ?? null,
        scans: tl.map((t: any) => ({ status: t.INTRANSIT_STATUS ?? '', date: t.INTRANSIT_DATE ?? '', time: t.INTRANSIT_TIME ?? '', location: t.INTRANSIT_LOCATION ?? '' })) };
    }).catch(() => null));
    const hits = (await Promise.all(tries)).filter(Boolean);
    return { number: n, hits };
  }

  async kind(vendor?: string | null): Promise<CarrierKind> {
    const v = String(vendor ?? '').trim().toUpperCase();
    if (!v || v === 'SELF') return 'SELF';
    if (await this.bd.isBlueDartVendor(v)) return 'BD';
    if (isDelhivery(v)) return 'DLY';
    if (isXpressBeesVendor(v)) return 'XB';
    if (isGatiVendor(v)) return 'GATI';
    if (isVExpressVendor(v)) return 'VXP';
    if (isArl(v)) return 'ARL';
    if (isDsCargoVendor(v)) return 'DSC';
    return 'OTHER';
  }

  private configured(k: CarrierKind) {
    return ({ BD: bdConfigured(), DLY: delConfigured(), XB: xbConfigured(), GATI: gatiConfigured(), VXP: vxConfigured(), ARL: arlConfigured() } as Record<string, boolean>)[k] ?? false;
  }

  /** Hand the AWB to its own carrier (by vendor code). Records the outcome on the shipment (bdError / bdDispatchAt). */
  async handoff(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, vendor: true, forwardingAwb: true, bdWaybill: true, statusCode: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    if (String(s.statusCode).toUpperCase() === 'CAN') throw new BadRequestException(`${awb} is cancelled.`);
    const k = await this.kind(s.vendor);
    const name = NAMES[k];
    if (s.bdWaybill || s.forwardingAwb) return { awb, carrier: k, carrierName: name, carrierAwb: s.bdWaybill || s.forwardingAwb, already: true, message: `Already with ${name} — ${s.bdWaybill || s.forwardingAwb}.` };
    if (k === 'SELF') throw new BadRequestException('This AWB is on our own network — pick a carrier (vendor) on the AWB first.');
    if (k === 'DSC' || k === 'OTHER') throw new BadRequestException(`${s.vendor} has no booking API — record their AWB with "Forward to vendor".`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { bdDispatchAt: new Date() } }).catch(() => {});
    try {
      let carrierAwb: string | null = null;
      let note = '';
      if (k === 'BD') { const r: any = await this.bd.generateWaybill(awb); carrierAwb = r?.bdWaybill ?? null; if (!carrierAwb && r?.token) note = `pickup token ${r.token}`; }
      if (k === 'DLY') { const r: any = await this.del.createManifest(awb); carrierAwb = r?.lrn ?? null; if (!carrierAwb && r?.jobId) note = 'LR is being created — it appears within minutes'; }
      if (k === 'XB') carrierAwb = (await this.xb.handoff(awb)).xbAwb;
      if (k === 'GATI') carrierAwb = (await this.gati.handoff(awb)).docket;
      if (k === 'VXP') carrierAwb = (await this.vx.handoff(awb)).lr;
      if (k === 'ARL') carrierAwb = (await this.arl.handoff(awb)).cn;
      await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: null } }).catch(() => {});
      return { awb, carrier: k, carrierName: name, carrierAwb, message: carrierAwb ? `Handed to ${name} — ${carrierAwb}.` : `Sent to ${name}${note ? ` (${note})` : ''}.` };
    } catch (e: any) {
      const msg = String(e?.response?.message || e?.message || e).slice(0, 500);
      await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: `${name}: ${msg}` } }).catch(() => {});
      throw new BadRequestException(`${name}: ${msg}`);
    }
  }

  /** Refresh tracking from the AWB's carrier. */
  async track(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { vendor: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    const k = await this.kind(s.vendor);
    const r: any =
      k === 'BD' ? await this.bd.syncTracking(awb)
      : k === 'DLY' ? await this.del.syncTracking(awb)
      : k === 'XB' ? await this.xb.syncTracking(awb)
      : k === 'GATI' ? await this.gati.syncTracking(awb)
      : k === 'VXP' ? await this.vx.syncTracking(awb)
      : k === 'ARL' ? await this.arl.syncTracking(awb)
      : k === 'DSC' ? await this.ds.syncTracking(awb)
      : null;
    if (!r) throw new BadRequestException(`${s.vendor || 'This carrier'} has no tracking integration.`);
    return { awb, carrier: k, carrierName: NAMES[k], status: r.status ?? r.bdStatus ?? null };
  }

  /**
   * Carrier suggestion for a booking: every carrier we have a price for (rate cards), plus live
   * serviceability + transit days where the carrier's API gives them. Serviceable first, then cheapest.
   */
  async suggest(dto: { clientId: number; product: string; originPincode?: string; destPincode: string; deadKg?: number; pcs?: number; declaredValue?: number; air?: boolean }) {
    if (!/^\d{6}$/.test(String(dto.destPincode || ''))) throw new BadRequestException('Destination pincode is required.');
    const priced: { vendor: string; total: number }[] = dto.clientId && dto.product
      ? ((await this.shipments.carrierRates(dto.clientId, dto).catch(() => null))?.options ?? []) : [];
    const vendors = await this.prisma.vendor.findMany({ where: { isActive: true }, select: { vendorCode: true, name: true } });
    const nameOf = (c: string) => vendors.find((v) => String(v.vendorCode).toUpperCase() === c.toUpperCase())?.name ?? c;
    const destPin = await this.prisma.pincode.findUnique({ where: { pincode: dto.destPincode }, select: { tatHours: true, isOda: true, edl: true } }).catch(() => null);
    const masterDays = destPin?.tatHours ? Math.ceil(destPin.tatHours / 24) : null;

    // Live checks (best-effort, time-boxed) for the carriers whose APIs answer them.
    const [bdSvc, delSvc, delTat] = await Promise.all([
      bdConfigured() ? withTimeout(this.bd.serviceability(dto.destPincode)) : Promise.resolve(null),
      delConfigured() ? withTimeout(this.del.serviceability(dto.destPincode).then(() => true).catch((e) => (/not serviceable/i.test(String(e?.message)) ? false : null))) : Promise.resolve(null),
      delConfigured() && /^\d{6}$/.test(String(dto.originPincode || '')) ? withTimeout(this.del.tat(String(dto.originPincode), dto.destPincode, dto.air ? 'A' : 'S')) : Promise.resolve(null),
    ]);
    const g: any = (bdSvc as any)?.GetServicesforPincodeResult;
    const bdOk = g ? (g.ErrorMessage === 'Valid' && !!String(g.AreaCode || '').trim() && (dto.air ? g.ApexInbound === 'Yes' : (g.GroundInbound === 'Yes' || g.ApexInbound === 'Yes'))) : null;
    const delDays = Number((delTat as any)?.data?.tat) || null;

    const codes = [...new Set([...priced.map((o) => String(o.vendor).toUpperCase()), ...vendors.map((v) => String(v.vendorCode).toUpperCase())])].filter((c) => c && c !== 'SELF');
    const rows: any[] = [];
    for (const code of codes) {
      const k = await this.kind(code);
      const price = priced.find((o) => String(o.vendor).toUpperCase() === code)?.total ?? null;
      const serviceable = k === 'BD' ? bdOk : k === 'DLY' ? (delSvc as boolean | null) : null;
      const tatDays = k === 'DLY' && delDays ? delDays : masterDays;
      // Only list carriers that are relevant: priced for this customer/lane, or with a live API answer.
      if (price == null && serviceable == null) continue;
      rows.push({
        vendor: code, name: nameOf(code), carrier: k, price, serviceable, tatDays, tatSource: k === 'DLY' && delDays ? 'carrier' : masterDays ? 'pincode master' : null,
        api: this.configured(k), note: serviceable === false ? 'Not serviceable for this pincode' : destPin?.isOda ? 'ODA location' : '',
      });
    }
    rows.sort((a, b) => (a.serviceable === false ? 1 : 0) - (b.serviceable === false ? 1 : 0) || (a.price ?? 1e12) - (b.price ?? 1e12) || (a.tatDays ?? 99) - (b.tatDays ?? 99));
    return { destPincode: dto.destPincode, oda: !!destPin?.isOda, carriers: rows };
  }

  // ---- auto hand-off of new bookings ----

  /** Every 3 min (AUTO_HANDOFF=false disables): hand new single bookings (made in the ERP / app / portal —
   *  not bulk uploads, which are often backdated history) to their API carrier. BlueDart has its own
   *  auto-dispatch. A failure is kept on the shipment (CS exceptions inbox) and retried after 6 hours. */
  onModuleInit() {
    if (String(process.env.AUTO_HANDOFF ?? 'true').toLowerCase() === 'false') return;
    const t = setInterval(() => this.autoHandoff().catch((e) => this.log.warn(`auto hand-off: ${e?.message || e}`)), 3 * 60_000);
    (t as any).unref?.();
  }

  async autoHandoff() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const enabled = new Set(String(process.env.AUTO_HANDOFF_CARRIERS ?? 'DLY,XB,GATI,VXP,ARL').split(',').map((x) => x.trim().toUpperCase()));
      const since = new Date(Math.max(Date.now() - 2 * 864e5, Date.parse(process.env.AUTO_HANDOFF_FROM ?? '2026-10-25T00:00:00+05:30')));
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdById: { not: null }, createdAt: { gte: since }, forwardingAwb: null, bdWaybill: null, vendor: { not: null },
          OR: [{ statusCode: null }, { statusCode: 'MAN' }],
          AND: [{ OR: [{ bdDispatchAt: null }, { bdDispatchAt: { lt: new Date(Date.now() - 6 * 3600_000) } }] }],
        },
        select: { awb: true, vendor: true, paymentTerm: true }, orderBy: { createdAt: 'asc' }, take: 50,
      });
      let ok = 0, failed = 0;
      for (const r of rows) {
        const k = await this.kind(r.vendor);
        if (k === 'BD' || !enabled.has(k) || !this.configured(k)) continue;
        try { await this.handoff(r.awb); ok++; } catch { failed++; }
        await new Promise((res) => setTimeout(res, 500));
      }
      if (ok || failed) this.log.log(`Auto hand-off: ${ok} handed, ${failed} failed.`);
    } finally {
      this.dispatching = false;
    }
  }
}
