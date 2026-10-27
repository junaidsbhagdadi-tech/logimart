import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveStatusFromBd } from '../bluedart/bd-status';
import { XB, xbConfigured, xbTrackConfigured } from './xpressbees.config';
import { cityName } from '../../common/place-name';

/**
 * XpressBees B2B cargo API (docs: Push Preship Cargo Manifest v1.2.1, Generate Bulk AWB, Global
 * Tracking, B2B AWB Cancellation, B2B Pickup Request).
 *
 * Flow: parent AWB + one child ShippingId per box come from OUR pool (XpressBees only issues them in
 * bulk, min 1,000 — see XbAwbPool) → AddCargoManifestDetails (max 10 boxes per call, same parent) →
 * the parent AWB becomes the shipment's forwardingAwb. Tracking needs a separate login token.
 */
type Route = 'Surface' | 'Air';

const CATEGORIES: [RegExp, string][] = [
  [/DOC|PAPER|FILE|LETTER|CHEQUE|CARD/i, 'Document'],
  [/MOBILE|PHONE|LAPTOP|ELECTRON|CABLE|CHARGER|TV|COMPUTER|PRINTER|BATTERY|LED|SPEAKER/i, 'Electronic goods'],
  [/OIL|LIQUID|PAINT|CHEMICAL|SANITIZ|SHAMPOO|LOTION|WATER/i, 'Liquid'],
  [/STEEL|IRON|METAL|ALUMIN|BRASS|COPPER|PIPE|HARDWARE|TOOL/i, 'Metal'],
  [/FURNITURE|CHAIR|TABLE|SOFA|BED|CABINET|WOOD/i, 'Furniture'],
  [/MEDIC|PHARMA|TABLET|DRUG|SURGICAL|HEALTH/i, 'Pharmaceuticals'],
  [/AUTO|SPARE|BEARING|TYRE|TIRE|ENGINE|VEHICLE|BIKE|CAR /i, 'Auto Parts'],
  [/FOOD|SNACK|SWEET|SPICE|TEA|COFFEE|RICE|GROCER|DRY ?FRUIT/i, 'Food Stuff'],
  [/GARMENT|CLOTH|APPAREL|SHIRT|SAREE|FABRIC|TEXTILE|SHOE|FOOTWEAR|BAG/i, 'Garments'],
  [/BABY|TOY|DIAPER/i, 'Baby Product'],
];

// XpressBees status code → wording our shared carrier-status mapper understands (null = no milestone yet).
const XB_TEXT: Record<string, string | null> = {
  DRC: null, OFP: null, PND: null, // data received / out for pickup / pickup not done
  PUD: 'PICKED UP', PKD: 'PICKED UP', IT: 'IN TRANSIT', RAD: 'REACHED DESTINATION',
  OFD: 'OUT FOR DELIVERY', DLVD: 'DELIVERED', UD: 'UNDELIVERED',
  RTON: 'RTO', RTO: 'RTO', 'RTO-IT': 'RTO', RAO: 'RTO', 'RTO-OFD': 'RTO', RTU: 'RTO', RTD: 'RTO DELIVERED',
  LOST: null,
};

const p2 = (n: number) => String(n).padStart(2, '0');
/** dd-MM-yyyy HH:mm:ss in IST (XpressBees' format). */
function istStamp(d: Date, withTime = true) {
  const t = new Date(d.getTime() + 330 * 60000);
  const day = `${p2(t.getUTCDate())}-${p2(t.getUTCMonth() + 1)}-${t.getUTCFullYear()}`;
  return withTime ? `${day} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}` : day;
}
const alnum = (v: any, max: number) => String(v ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const alpha = (v: any, max: number) => String(v ?? '').replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const mobile = (v: any) => { const d = String(v ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `+91${d}` : ''; };

@Injectable()
export class XpressBeesService implements OnModuleInit {
  private readonly log = new Logger('XpressBees');
  private syncing = false;
  constructor(private readonly prisma: PrismaService) {}

  /** Keep XpressBees tracking live without clicks (XB_SYNC_INTERVAL_MIN, default 15; 0 = off). */
  onModuleInit() {
    const mins = Number(process.env.XB_SYNC_INTERVAL_MIN ?? 15);
    if (!xbTrackConfigured() || !(mins > 0)) return;
    const t = setInterval(() => this.autoSync().catch((e) => this.log.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (t as any).unref?.();
    this.log.log(`XpressBees tracking auto-sync every ${mins} min.`);
  }

  /** Sync open XpressBees shipments booked in the last 30 days (throttled, best-effort). */
  async autoSync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 864e5) }, forwardingAwb: { not: null },
          vendor: { in: ['XPB', 'XB', 'XPRESSBEES', 'XpressBees'] },
          OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }],
        },
        select: { awb: true }, take: 300,
      });
      for (const r of rows) {
        try { await this.syncTracking(r.awb); } catch { /* keep going */ }
        await new Promise((res) => setTimeout(res, 400));
      }
    } finally {
      this.syncing = false;
    }
  }

  private ensure() {
    if (!xbConfigured()) {
      throw new BadRequestException('XpressBees not configured — set XB_KEY, XB_AWB_TOKEN (and XB_ACCESS_KEY if different from XB_KEY) on the server.');
    }
  }

  async status() {
    const pool = await this.prisma.$queryRawUnsafe<any[]>(
      `select kind, "routeMode", count(*) filter (where "usedAt" is null)::int free, count(*)::int total from xb_awb_pool group by 1,2 order by 1,2`,
    ).catch(() => []);
    return {
      configured: xbConfigured(),
      tracking: xbTrackConfigured(),
      key: XB.key ? 'set' : 'missing',
      awbToken: XB.awbToken ? 'set' : 'missing',
      pickupLocation: XB.pickupLocation || 'missing',
      defaultCategory: XB.defaultCategory || 'not set',
      env: /stage|apistage/i.test(XB.manifestUrl) ? 'STAGING' : 'PRODUCTION',
      pool,
    };
  }

  private async post(url: string, body: unknown, headers: Record<string, string>) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let data: any; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok && !data?.ReturnCode && !data?.code && !data?.Code) throw new BadRequestException(`XpressBees ${res.status}: ${text.slice(0, 300)}`);
    return data;
  }

  // ---- AWB pool ----

  /** Fetch a batch of numbers into the pool (min 1,000 per XpressBees). */
  async refill(kind: 'AWB' | 'MPS', routeMode: Route, quantity = 1000) {
    this.ensure();
    const r = await this.post(XB.awbUrl, { xbaccesskey: XB.accessKey, routemode: routeMode, awbtype: kind, quantity: String(Math.max(1000, quantity)) }, { token: XB.awbToken });
    const nums: string[] = Array.isArray(r?.data) ? r.data.map(String) : [];
    if (String(r?.status).toUpperCase() !== 'SUCCESS' || !nums.length) {
      throw new BadRequestException(`XpressBees AWB generation failed (${r?.code ?? '?'}): ${r?.message ?? JSON.stringify(r).slice(0, 200)}`);
    }
    const res = await this.prisma.xbAwbPool.createMany({ data: nums.map((number) => ({ number, kind, routeMode })), skipDuplicates: true });
    this.log.log(`pool +${res.count} ${kind}/${routeMode}`);
    return { added: res.count };
  }

  /** Take `n` unused numbers (safe across instances: row locks, SKIP LOCKED); refills once if short. */
  private async allocate(kind: 'AWB' | 'MPS', routeMode: Route, n: number, forAwb: string): Promise<string[]> {
    const take = () => this.prisma.$queryRawUnsafe<{ number: string }[]>(
      `update xb_awb_pool set "usedFor" = $1, "usedAt" = now()
        where id in (select id from xb_awb_pool where kind = $2 and "routeMode" = $3 and "usedAt" is null order by id limit $4 for update skip locked)
        returning number`, forAwb, kind, routeMode, n,
    );
    let got = (await take()).map((r) => r.number);
    if (got.length < n) {
      await this.release(got);
      await this.refill(kind, routeMode, Math.max(1000, n));
      got = (await take()).map((r) => r.number);
    }
    if (got.length < n) { await this.release(got); throw new BadRequestException(`XpressBees ${kind} pool exhausted for ${routeMode}.`); }
    return got;
  }

  /** Put numbers back (the manifest didn't use them). */
  private async release(numbers: string[]) {
    if (numbers.length) await this.prisma.xbAwbPool.updateMany({ where: { number: { in: numbers } }, data: { usedFor: null, usedAt: null } });
  }

  // ---- hand-off (manifest) ----

  private category(s: any): string {
    if (String(s.docType || '').toUpperCase() === 'DOX') return 'Document';
    const hit = CATEGORIES.find(([re]) => re.test(String(s.goodsDesc || '')));
    if (hit) return hit[1];
    if (XB.defaultCategory) return XB.defaultCategory;
    throw new BadRequestException('XpressBees needs a product category — put the content (e.g. "garments", "auto parts") on the AWB, or set XB_DEFAULT_CATEGORY on the server.');
  }

  /** Manifest a Logimart shipment to XpressBees; the parent AWB becomes the forwarding AWB. */
  async handoff(awb: string) {
    this.ensure();
    const s: any = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: { orderBy: { sequenceNo: 'asc' } } } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    if (s.forwardingAwb) throw new BadRequestException(`${awb} already has a carrier AWB (${s.forwardingAwb}).`);
    const route: Route = /AIR/i.test(String(s.serviceMode)) ? 'Air' : 'Surface';
    const pieces = s.pieces.length ? s.pieces : [{ sequenceNo: 1, deadKg: s.totalDeadKg || 0.5 }];
    const value = Number(s.declaredValue ?? s.shipmentValue ?? 0);
    const category = this.category(s);
    if (category !== 'Document' && !(value > 0)) throw new BadRequestException('XpressBees needs the invoice value (₹) — add it on the AWB.');

    const toPay = String(s.paymentTerm).toUpperCase() === 'TO_PAY';
    const c = s.client ?? {};
    const shipCity = await cityName(this.prisma, String(s.shipperPincode || c.pincode || ''), s.shipperCity, c.city);
    const consCity = await cityName(this.prisma, String(s.destPincode || ''), s.consigneeCity);
    const shipper = {
      CompanyName: alnum(s.shipperName || c.legalName, 50), SPOCPersonName: alpha(s.shipperContact || c.contactName || s.shipperName || c.legalName, 100) || 'Shipper',
      Address: String([s.shipperAddress1, s.shipperAddress2].filter(Boolean).join(', ') || c.addressLine || '').slice(0, 250),
      State: String(s.shipperState || c.state || '').slice(0, 50), City: shipCity.slice(0, 50),
      Pincode: Number(s.shipperPincode || c.pincode || 0), MobileNo: mobile(c.contactPhone || s.shipperContact), EmailID: String(c.contactEmail || '').split(/[,;]/)[0].trim(), TINNo: '',
    };
    const consignee = {
      CompanyName: alnum(s.consigneeName, 50) || 'Consignee', SPOCPersonName: alpha(s.consigneeName, 100) || 'Consignee',
      Address: String(s.consigneeAddress || '').slice(0, 250), State: String(s.consigneeState || '').slice(0, 50), City: consCity.slice(0, 50),
      Pincode: Number(s.destPincode || 0), MobileNo: mobile(s.consigneePhone), EmailID: '', TINNo: '',
    };
    const missing = [
      !shipper.Address && 'shipper address', !(shipper.Pincode > 0) && 'shipper pincode', !shipper.MobileNo && 'shipper 10-digit mobile',
      !consignee.Address && 'consignee address', !(consignee.Pincode > 0) && 'consignee pincode', !consignee.MobileNo && 'consignee 10-digit mobile',
      !consignee.City && 'consignee city',
    ].filter(Boolean);
    if (missing.length) throw new BadRequestException(`XpressBees needs: ${missing.join(', ')} — fix them on the AWB (Edit AWB).`);

    // ≥ ₹50,000 → XpressBees validates the GST / e-way bill block.
    let gst: any[] | undefined;
    if (value >= 50000) {
      if (!s.ewbNo || !/^\d{1,15}$/.test(String(s.ewbNo))) throw new BadRequestException('Invoice value is ₹50,000+ — XpressBees needs the e-way bill number on the AWB.');
      if (!s.hsnCode) throw new BadRequestException('Invoice value is ₹50,000+ — XpressBees needs the HSN code on the AWB.');
      gst = [{
        InvoiceNo: String(s.custInvoiceNo || s.referenceNo || s.awb).slice(0, 50), InvoiceDate: istStamp(s.createdAt, false), InvoiceValue: value,
        IsSellerRegUnderGST: (s.consignorGstin || c.gstin) ? 'Yes' : 'No', SellerGSTRegNumber: s.consignorGstin || c.gstin || '',
        BuyerGSTRegNumber: s.consigneeGstin || '', SupplyStatePlace: shipper.State, EBN: String(s.ewbNo),
        EBNExpiryDate: s.ewbValidUpto ? istStamp(new Date(s.ewbValidUpto)) : istStamp(new Date(Date.now() + 86400000)),
        SellerName: shipper.CompanyName, SellerAddress: shipper.Address, SellerPincode: String(shipper.Pincode), SupplySellerStatePlace: shipper.City,
        HSNDetails: [{ HSNCode: String(s.hsnCode), ProductCategory: category, ProductDescription: String(s.goodsDesc || category).slice(0, 100), TaxableValue: value }],
      }];
    }

    const [parent] = await this.allocate('AWB', route, 1, awb);
    let kids: string[] = [];
    try {
      kids = await this.allocate('MPS', route, pieces.length, awb);
    } catch (e) { await this.release([parent]); throw e; }

    const vtc = !!s.isDod && Number(s.dodAmount) > 0;
    const base: any = {
      ParentAWB: parent, BookingMode: toPay ? 'ToPay' : 'Credit', RouteMode: route,
      Addresses: [
        { Type: 'Shipper address', ...shipper },
        { Type: 'Consignee address', ...consignee },
        { Type: 'RTO address', ...shipper },
        ...(vtc ? [{ Type: 'VTC delivery address', ...shipper }] : []),
      ],
      PickUpDateTime: istStamp(new Date()), InvoiceValue: value || 0, ClientReferenceno: String(s.awb),
      AWBPhysicalWeight: Number(s.totalDeadKg || s.chargeWeight || 0.5), AWBPhysicalWeightUnit: 'KG',
      Category: category, MPSCount: pieces.length,
      FTCPaymentMode: toPay ? 'Cash' : '',
      VTC: vtc ? 1 : 0, ...(vtc ? { VTCPaymentMode: s.dodInstrument === 'DD' ? 'DD' : 'Cheque', VTCAmount: Number(s.dodAmount) } : {}),
      RoadPermit: 0, DCCopy: 0, RiskSurcharge: 'OR-Owner risk',
      ...(gst ? { GSTMultiSellerInfo: gst } : {}),
    };
    const mps = pieces.map((pc: any, i: number) => ({
      ShippingId: kids[i],
      ...(pc.lengthCm && pc.widthCm && pc.heightCm ? { Length: Number(pc.lengthCm), Breadth: Number(pc.widthCm), Height: Number(pc.heightCm), LBHUnit: 'CM' } : {}),
      MPSValue: +(value / pieces.length).toFixed(2), PhysicalWeight: Number(pc.deadKg || 0.5), PhysicalWeightUnit: 'KG',
    }));

    // Max 10 boxes per request, same parent AWB each time.
    const responses: any[] = [];
    let ok = 0;
    for (let i = 0; i < mps.length; i += 10) {
      const r = await this.post(XB.manifestUrl, { ...base, MPSNO: mps.slice(i, i + 10) }, { XBKey: XB.key, version: 'v1' });
      responses.push(r);
      if (Number(r?.ReturnCode) !== 100) {
        if (i === 0) await this.release([parent, ...kids]);
        // Part of a >10-box shipment already went through — keep the parent on the AWB so CS can see / cancel it.
        else await this.prisma.shipment.update({ where: { id: s.id }, data: { forwardingAwb: parent, vendor: s.vendor || 'XPB', bdStatus: `Partly manifested (XpressBees, ${i} of ${mps.length} boxes)` } });
        throw new BadRequestException(`XpressBees refused ${awb} (${r?.ReturnCode}): ${r?.ReturnMessage || r?.AuthKey || 'unknown error'}${Number(r?.ReturnCode) === 102 ? ' — ask XpressBees to whitelist server IP 168.144.77.53' : ''}`);
      }
      ok += Number(r?.MPSSuccessfulCount ?? 0);
    }

    await this.prisma.$transaction([
      this.prisma.shipment.update({ where: { id: s.id }, data: { forwardingAwb: parent, vendor: s.vendor || 'XPB', bdStatus: 'Manifested (XpressBees)', bdHandedAt: new Date() } }),
      ...pieces.filter((pc: any) => pc.id).map((pc: any, i: number) => this.prisma.shipmentPiece.update({ where: { id: pc.id }, data: { carrierChildId: kids[i] } })),
    ]);
    return { awb, xbAwb: parent, boxes: kids, mpsSuccessful: ok, response: responses };
  }

  /** Cancel at XpressBees — allowed only while it is "Pending" / "Pickup Not Done". */
  async cancel(awb: string, by = 'Logimart') {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, forwardingAwb: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No XpressBees AWB on ${awb} to cancel.`);
    const r = await this.post(XB.cancelUrl, { XBkey: XB.key, AWBNo: s.forwardingAwb, UpdatedBy: by.slice(0, 50) }, {});
    if (Number(r?.ReturnCode) !== 100) throw new BadRequestException(`XpressBees did not cancel ${s.forwardingAwb}: ${r?.ReturnMessage ?? 'unknown error'}`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { bdStatus: 'CANCELLED (XpressBees)', forwardingAwb: null } });
    return { awb, cancelled: s.forwardingAwb };
  }

  // ---- tracking ----

  private async trackToken(force = false): Promise<string> {
    if (!xbTrackConfigured()) throw new BadRequestException('XpressBees tracking not configured — set XB_TRACK_USERNAME, XB_TRACK_PASSWORD, XB_TRACK_SECRET.');
    if (!force) {
      const c = await this.prisma.integrationToken.findUnique({ where: { provider: 'XPRESSBEES' } });
      if (c && c.expiresAt.getTime() > Date.now() + 60_000) return c.token;
    }
    const r = await this.post(XB.authUrl, { username: XB.trackUser, password: XB.trackPass, secretkey: XB.trackSecret }, {});
    const token = r?.token;
    if (!token) throw new BadRequestException(`XpressBees tracking login failed: ${JSON.stringify(r).slice(0, 200)}`);
    // Expiry from the JWT when readable, else assume 50 minutes.
    let exp = Date.now() + 50 * 60_000;
    try { const j = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString()); if (j.exp) exp = j.exp * 1000; } catch { /* opaque token */ }
    await this.prisma.integrationToken.upsert({ where: { provider: 'XPRESSBEES' }, update: { token, expiresAt: new Date(exp) }, create: { provider: 'XPRESSBEES', token, expiresAt: new Date(exp) } });
    return token;
  }

  async track(xbAwb: string) {
    const get = async (tok: string) => fetch(`${XB.trackUrl}/${encodeURIComponent(xbAwb)}`, { headers: { 'Content-Type': 'application/json', token: tok } });
    let res = await get(await this.trackToken());
    if (res.status === 401 || res.status === 403) res = await get(await this.trackToken(true));
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new BadRequestException(`XpressBees tracking ${res.status}: ${text.slice(0, 200)}`);
    return data;
  }

  /** Pull the latest XpressBees scan onto the shipment (carrier status text + our milestone). */
  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true, statusCode: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No XpressBees AWB on ${awb} to track.`);
    const r = await this.track(s.forwardingAwb);
    const parse = (t: string) => { const m = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(t || ''); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) : 0; };
    const scans: any[] = (r?.data?.shipmentDetails?.shipmentStatus ?? []).flatMap((b: any) => b?.status ?? []);
    scans.sort((a, b) => parse(a.statusDateTime) - parse(b.statusDateTime));
    const last = scans[scans.length - 1];
    if (!last) return { awb, xbAwb: s.forwardingAwb, status: null, tracking: r };
    // A second PKD at another hub is an in-transit hop, not a fresh pickup.
    const pkdHubs = new Set(scans.filter((x) => x.statusCode === 'PKD').map((x) => x.shipmentLocation));
    const code = String(last.statusCode || '').toUpperCase();
    const text = code === 'PKD' && pkdHubs.size > 1 ? 'IN TRANSIT' : XB_TEXT[code];
    const label = `${last.remark || last.status || code}${last.shipmentLocation ? ` — ${last.shipmentLocation}` : ''} (XpressBees)`;
    const derived = text ? deriveStatusFromBd(s.statusCode, text) : null;
    await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus: label, ...(derived ? { statusCode: derived.statusCode, status: derived.status, statusAt: new Date() } : {}) } });
    return { awb, xbAwb: s.forwardingAwb, status: label, statusCode: derived?.statusCode ?? s.statusCode, tracking: r };
  }

  // ---- pickup request ----

  /** Raise an XpressBees pickup (returns their PickupRequestId). Same-day only before 2 PM IST. */
  async bookPickup(p: {
    pincode: string; destPincode: string; address: string; contactName: string; phone: string; email?: string | null;
    weightKg?: number; boxes?: number; toPay?: boolean; air?: boolean; gstin?: string | null; instructions?: string | null;
  }) {
    this.ensure();
    if (!XB.pickupLocation) throw new BadRequestException('Set XB_PICKUP_LOCATION (the pickup location id registered with XpressBees).');
    const email = String(p.email || '').split(/[,;]/)[0].trim() || XB.pickupEmail;
    if (!email) throw new BadRequestException('XpressBees needs a contact email for the pickup — add one on the customer, or set XB_PICKUP_EMAIL.');
    const ist = new Date(Date.now() + 330 * 60000);
    const day = new Date(ist.getTime() + (ist.getUTCHours() >= 14 ? 86400000 : 0)); // after the 2 PM cut-off → tomorrow
    const r = await this.post(XB.pickupUrl, {
      PickupLocation: XB.pickupLocation, RouteMode: p.air ? 'Air' : 'Surface', BookingMode: p.toPay ? 'ToPay' : 'Credit', TruckLoadType: 'PTL',
      PickupPincode: String(p.pincode), DestinationPincode: String(p.destPincode), ContactName: alpha(p.contactName, 100) || 'Shipper',
      Email: email, PhysicalWeight: String(p.weightKg || 1), NumberOfMPS: String(p.boxes || 1),
      RequestedPickupDate: `${day.getUTCFullYear()}-${p2(day.getUTCMonth() + 1)}-${p2(day.getUTCDate())}`,
      PickupInstruction: p.instructions || 'NA', PickupAddress: String(p.address).slice(0, 250),
      ContactNumber: String(p.phone).replace(/\D/g, '').slice(-10), GSTNo: p.gstin || 'URP',
    }, { XBKey: XB.key });
    if (Number(r?.Code) !== 200 || !r?.PickupRequestId) throw new BadRequestException(`XpressBees pickup refused: ${r?.Message ?? JSON.stringify(r).slice(0, 200)}`);
    return { pickupRequestId: String(r.PickupRequestId), requestId: r.RequestId };
  }
}
