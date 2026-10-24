import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveStatusFromBd } from '../bluedart/bd-status';

/**
 * Gati / Allcargo Logistics B2B API (doc "Allcargo Logistics Ltd-api-json"). Env (droplet .env):
 *   GATI_ENV              uat | prod (default prod)         — uat = pg-uat.gati.com/pickupservices
 *   GATI_CUST_CODE        8-digit customer code (e.g. Tuvas 30816701; UAT test code 87654321)
 *   GATI_ENC_CUST_CODE    encrypted customer code — p1 for docket download, p3 for package series   SECRET
 *   GATI_TRACK_TOKEN      16-digit security token for tracking (p2)                                   SECRET
 *   GATI_PIN_REQID        16-digit reqid for pincode serviceability                                   SECRET
 *   GATI_DEFAULT_GOODS_CODE  goods code when the content doesn't say (doc list, e.g. 33 MISC MANUFACTURED)
 * Allcargo whitelists the calling server's public IP (ours: 168.144.77.53).
 *
 * Booking: pincode check → register the pickup point ("vendor", once) → download a docket → download a
 * package series → post the pickup (GATIKWEJPICKUPLBH). Docket = forwardingAwb, package nos = box ids.
 */
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const UAT = /^uat$/i.test(env('GATI_ENV', 'prod'));
const BASE = UAT ? 'https://pg-uat.gati.com/pickupservices' : 'https://justi.gati.com/webservices';
const G = {
  cust: env('GATI_CUST_CODE'),
  enc: env('GATI_ENC_CUST_CODE'),
  trackToken: env('GATI_TRACK_TOKEN'),
  pinReqId: env('GATI_PIN_REQID'),
  goodsDefault: env('GATI_DEFAULT_GOODS_CODE'),
};
export const gatiConfigured = () => !!(G.cust && G.enc);
export const isGatiVendor = (v?: string | null) => /^GATI$|ALLCARGO/i.test(String(v ?? '').trim());

// Goods codes (Allcargo cargo class) by keyword in the goods description.
const GOODS: [RegExp, string][] = [
  [/GARMENT|APPAREL|SHIRT|CLOTH|FABRIC|TEXTILE/i, '37'], [/SAREE/i, '507'], [/AUTO|SPARE|VEHICLE/i, '14'],
  [/LAPTOP/i, '208'], [/COMPUTER|PRINTER/i, '19'], [/ELECTRONIC|MOBILE|PHONE|TV/i, '24'], [/ELECTRICAL|CABLE|WIRE/i, '25'],
  [/PHARMA|MEDIC|DRUG|TABLET/i, '23'], [/COSMETIC/i, '20'], [/CHEMICAL/i, '16'], [/MACHINE|MACHINERY/i, '32'],
  [/FOOD|SNACK|SPICE|GROCER/i, '402'], [/BOOK/i, '601'], [/STATIONER/i, '603'], [/FURNITURE|WOOD/i, '42'],
  [/GLASS/i, '30'], [/PLASTIC/i, '406'], [/TOY|BABY/i, '414'], [/HOUSEHOLD|HOUSE HOLD/i, '401'], [/STEEL|IRON|METAL/i, '306'],
];

// Gati transit status code → wording our shared carrier mapper understands (null = no milestone change).
const GATI_TEXT: Record<string, string | null> = {
  DCRE: null, DCRB: null, PAC: null, NAS: null, ACP: null,
  CLO: 'PICKED UP', TCSOU: 'IN TRANSIT', TCAER: 'IN TRANSIT', TCSEO: 'IN TRANSIT',
  DKTAD: 'REACHED DESTINATION', TCADO: 'REACHED DESTINATION', DPDCC: 'OUT FOR DELIVERY',
  DDLVD: 'DELIVERED', DDPVD: 'DELIVERED', DUNDL: 'UNDELIVERED', DRTO: 'RTO', REDRTO: 'RTO',
};

const p2 = (n: number) => String(n).padStart(2, '0');
function istStamp(d = new Date()) {
  const t = new Date(d.getTime() + 330 * 60000);
  return `${p2(t.getUTCDate())}-${p2(t.getUTCMonth() + 1)}-${t.getUTCFullYear()} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
}
const cut = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const mobile = (...vals: any[]) => vals.map((v) => String(v ?? '').replace(/\D/g, '').slice(-10)).find((v) => v.length === 10) ?? '';

@Injectable()
export class GatiService implements OnModuleInit {
  private readonly log = new Logger('Gati');
  private syncing = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const mins = Number(process.env.GATI_SYNC_INTERVAL_MIN ?? 30);
    if (!G.trackToken || !(mins > 0)) return;
    const t = setInterval(() => this.autoSync().catch((e) => this.log.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (t as any).unref?.();
  }

  status() {
    return {
      configured: gatiConfigured(), env: UAT ? 'UAT' : 'PRODUCTION',
      custCode: G.cust || 'missing', encCustCode: G.enc ? 'set' : 'missing', trackToken: G.trackToken ? 'set' : 'missing',
      pinReqId: G.pinReqId ? 'set' : 'missing', defaultGoodsCode: G.goodsDefault || 'not set',
    };
  }

  private ensure() {
    if (!gatiConfigured()) throw new BadRequestException('Gati not configured — set GATI_CUST_CODE and GATI_ENC_CUST_CODE (and GATI_TRACK_TOKEN, GATI_PIN_REQID) on the server.');
  }

  private async call(path: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers as any || {}) } });
    const text = (await res.text()).trim();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new BadRequestException(`Gati ${res.status} (${path.split('?')[0]}): ${text.slice(0, 250)}`);
    return data;
  }

  /** Serviceability of a pincode → Gati delivery location code(s). */
  async pincode(pin: string) {
    if (!G.pinReqId) throw new BadRequestException('Set GATI_PIN_REQID (16-digit token for the pincode service).');
    return this.call(`GKEPincodeserviceablity.jsp?reqid=${encodeURIComponent(G.pinReqId)}&pincode=${encodeURIComponent(pin)}`, { method: 'POST' });
  }

  /** Register the pickup address as a customer "vendor" (once) — returns its 15-digit code. */
  private async ensureVendor(s: any): Promise<string> {
    const c = s.client ?? {};
    const address = cut([s.shipperAddress1, s.shipperAddress2].filter(Boolean).join(', ') || c.addressLine, 150);
    const pin = String(s.shipperPincode || c.pincode || '').trim();
    const phone = mobile(s.shipperMobile, s.shipperContact, c.contactPhone, c.tel1);
    const missing = [!address && 'pickup address', !/^\d{6}$/.test(pin) && 'pickup pincode', !phone && 'pickup 10-digit mobile'].filter(Boolean);
    if (missing.length) throw new BadRequestException(`Gati needs the ${missing.join(', ')} to register the pickup point — fix it on the AWB (Edit AWB).`);
    let h = 0; for (const ch of `${c.accountCode}|${address.toUpperCase().replace(/[^A-Z0-9]/g, '')}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const code = `${pin}${String(h % 1e9).padStart(9, '0')}`; // numeric, 15 digits
    if (await this.prisma.gatiVendor.findUnique({ where: { code } })) return code;
    const pc = await this.prisma.pincode.findUnique({ where: { pincode: pin }, select: { city: true } }).catch(() => null);
    const r = await this.call('GKEJCustVendDtls.jsp', {
      method: 'POST',
      body: JSON.stringify({
        custCode: G.cust,
        details: [{
          custVendorCode: code, custVendorName: cut(s.shipperName || c.legalName, 50),
          vendorAdd1: cut(address.slice(0, 50), 50), vendorAdd2: cut(address.slice(50, 100) || (s.shipperCity || c.city || pc?.city || '.'), 50), vendorAdd3: cut(address.slice(100, 150), 50),
          vendorCity: cut(s.shipperCity || c.city || pc?.city, 20), vendorPhoneNo: phone, vendorPincode: pin, vendorEmail: cut(String(c.contactEmail || '').split(/[,;]/)[0], 50),
          vendorReceiverFlag: 'V', vendorTinno: c.gstin || 'NA', VendorGSTNO: s.consignorGstin || c.gstin || 'NA',
        }],
      }),
    });
    const msg = String(r?.details?.[0]?.errmsg ?? r?.errmsg ?? '');
    if (String(r?.postedData).toLowerCase() !== 'successful' || (msg && !/succes|exist|already/i.test(msg))) {
      throw new BadRequestException(`Gati could not register the pickup point: ${msg || JSON.stringify(r).slice(0, 200)}`);
    }
    await this.prisma.gatiVendor.upsert({ where: { code }, update: {}, create: { code, clientId: s.clientId ?? null, pincode: pin, address } });
    return code;
  }

  /** Hand a shipment to Gati: docket + package series + pickup post. */
  async handoff(awb: string) {
    this.ensure();
    const s: any = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: { orderBy: { sequenceNo: 'asc' } } } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    if (s.forwardingAwb) throw new BadRequestException(`${awb} already has a carrier docket (${s.forwardingAwb}).`);
    const value = Number(s.declaredValue ?? s.shipmentValue ?? 0);
    if (!(value > 0)) throw new BadRequestException('Gati needs the declared goods value (cannot be 0) — add it on the AWB.');
    const recvPhone = mobile(s.consigneePhone);
    const recvAddr = cut(s.consigneeAddress, 200);
    const missing = [!s.consigneeName && 'consignee name', !recvAddr && 'consignee address', !s.consigneeCity && 'consignee city', !/^\d{6}$/.test(String(s.destPincode || '')) && 'consignee pincode', !recvPhone && 'consignee 10-digit mobile'].filter(Boolean);
    if (missing.length) throw new BadRequestException(`Gati needs: ${missing.join(', ')} — fix them on the AWB (Edit AWB).`);
    const goodsCode = GOODS.find(([re]) => re.test(String(s.goodsDesc || '')))?.[1] || G.goodsDefault;
    if (!goodsCode) throw new BadRequestException('Gati needs a goods code — put the content on the AWB (e.g. "garments", "auto parts") or set GATI_DEFAULT_GOODS_CODE.');

    const vendorCode = await this.ensureVendor(s);
    const pieces = s.pieces.length ? s.pieces : [{ deadKg: s.totalDeadKg || 1 }];

    // 1 docket per call.
    const dk = await this.call(`GKEdktdownloadjson.jsp?p1=${encodeURIComponent(G.enc)}`, { method: 'GET' });
    const docket = String(dk?.docketNo ?? '').trim();
    if (!/^\d{9}$/.test(docket)) throw new BadRequestException(`Gati gave no docket number (${docket || JSON.stringify(dk).slice(0, 120)}) — ask Allcargo to allocate dockets to the account.`);
    // Consecutive package numbers for the boxes.
    const ps = await this.call(`Custpkgseries.jsp?p1=${docket}&p2=${pieces.length}&p3=${encodeURIComponent(G.enc)}&p4=${encodeURIComponent(String(s.shipperPincode || s.client?.pincode || s.destPincode))}`, { method: 'GET' });
    if (String(ps?.result).toLowerCase() !== 'successful') throw new BadRequestException(`Gati package numbers unavailable: ${ps?.sErrMsg || ps?.raw?.slice?.(0, 160) || 'unknown'} — ask Allcargo to allocate package series.`);
    const from = Number(ps.frmNo);
    const pkgNos = pieces.map((_: any, i: number) => from + i);

    const toPay = String(s.paymentTerm).toUpperCase() === 'TO_PAY';
    const dod = !!s.isDod && Number(s.dodAmount) > 0;
    const body = {
      custCode: G.cust, pickupRequest: istStamp(),
      details: [{
        docketNo: docket, goodsCode, declCargoVal: value.toFixed(2),
        actualWt: Number(s.totalDeadKg || 0.5).toFixed(2), chargedWt: Number(s.chargeWeight || s.totalDeadKg || 0.5).toFixed(2),
        shipperCode: G.cust, orderNo: cut(s.custInvoiceNo || s.referenceNo || s.awb, 20),
        ...(dod ? { codAmt: Number(s.dodAmount).toFixed(2), codInFavourOf: 'S' } : { codAmt: '0' }),
        receiverCode: '99999', receiverName: cut(s.consigneeName, 50),
        receiverAdd1: cut(recvAddr.slice(0, 50), 50), receiverAdd2: cut(recvAddr.slice(50, 100) || s.consigneeCity, 50),
        receiverAdd3: cut(recvAddr.slice(100, 150), 50), receiverAdd4: cut(recvAddr.slice(150, 200), 50),
        receiverCity: cut(s.consigneeCity, 20), receiverPhoneNo: recvPhone, receiverMobileNo: recvPhone,
        receiverEmail: 'na@na.com', receiverPinCode: String(s.destPincode),
        noOfPkgs: String(pieces.length), fromPkgNo: String(pkgNos[0]), toPkgNo: String(pkgNos[pkgNos.length - 1]),
        pkgDetails: { pkginfo: pieces.map((pc: any, i: number) => ({ pkgNo: pkgNos[i], pkgLn: Number(pc.lengthCm || 1), pkgBr: Number(pc.widthCm || 1), pkgHt: Number(pc.heightCm || 1), pkgWt: Number(pc.deadKg || 0.5) })) },
        CustDeliveyDate: '', SPL_Instruction: '', prodServCode: /AIR/i.test(String(s.serviceMode)) ? '2' : '1',
        custVendCode: vendorCode, goodsDesc: cut(s.goodsDesc || 'General goods', 200),
        bookingBasis: toPay ? '4' : '2', // 2 = contractual (our account), 4 = FOD (to-pay)
        UOM: 'CC', consignorGSTINNo: s.consignorGstin || s.client?.gstin || '', ReceiverGSTINNo: s.consigneeGstin || '',
        ...(s.ewbNo ? { EWAYBILL: String(s.ewbNo), ...(s.ewbValidUpto ? { EWB_EXP_DT: istStamp(new Date(s.ewbValidUpto)).slice(0, 10) } : {}) } : {}),
      }],
    };
    const r = await this.call('GATIKWEJPICKUPLBH.jsp', { method: 'POST', body: JSON.stringify(body) });
    const msg = String(r?.details?.[0]?.errmsg ?? r?.errmsg ?? '');
    if (String(r?.postedData).toLowerCase() !== 'successful' || !/succes/i.test(msg)) {
      throw new BadRequestException(`Gati refused ${awb} (docket ${docket}): ${msg || JSON.stringify(r).slice(0, 250)}`);
    }
    await this.prisma.$transaction([
      this.prisma.shipment.update({ where: { id: s.id }, data: { forwardingAwb: docket, vendor: s.vendor || 'GATI', bdStatus: 'Docket created (Gati)', bdHandedAt: new Date() } }),
      ...s.pieces.map((pc: any, i: number) => this.prisma.shipmentPiece.update({ where: { id: pc.id }, data: { carrierChildId: String(pkgNos[i]) } })),
    ]);
    return { awb, docket, packages: pkgNos.map(String), printUrl: this.printUrl(docket), stickerUrl: this.stickerUrl(docket), response: r };
  }

  printUrl(docket: string) { return `https://www.gati.com/Greport/InterfaceA4Print.jsp?p1=${docket}&p2=${G.cust}`; }
  stickerUrl(docket: string, size: 3 | 4 = 3) { return `https://www.gati.com/Greport/GATICOM_CUSTPKG.jsp?p1=${size}&p=${docket}&p3=3`; }

  async cancel(awb: string, reason = 'Cancelled by customer') {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, forwardingAwb: true, referenceNo: true, custInvoiceNo: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No Gati docket on ${awb} to cancel.`);
    const r = await this.call('b2bCanPickup.jsp', {
      method: 'POST',
      body: JSON.stringify({ pickupRequest: istStamp(), custCode: Number(G.cust), details: [{ docketNo: s.forwardingAwb, shipperCode: Number(G.cust), orderNo: cut(s.custInvoiceNo || s.referenceNo || awb, 20), canReason: cut(reason, 100) }] }),
    });
    const msg = String(r?.details?.[0]?.errmsg ?? '');
    if (!/cancel/i.test(msg)) throw new BadRequestException(`Gati did not cancel docket ${s.forwardingAwb}: ${msg || JSON.stringify(r).slice(0, 200)}`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { bdStatus: 'CANCELLED (Gati)' } });
    return { awb, cancelled: s.forwardingAwb };
  }

  async track(dockets: string) {
    if (!G.trackToken) throw new BadRequestException('Set GATI_TRACK_TOKEN (16-digit tracking token).');
    return this.call(`GatiKWEDktJTrack.jsp?p1=${encodeURIComponent(dockets)}&p2=${encodeURIComponent(G.trackToken)}`, { method: 'GET' });
  }

  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true, statusCode: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No Gati docket on ${awb} to track.`);
    const r = await this.track(s.forwardingAwb);
    const d = r?.Gatiresponse?.dktinfo?.[0];
    if (!d || d.errmsg) throw new BadRequestException(`Gati tracking: ${d?.errmsg || 'no data'}`);
    const latest = (d.TRANSIT_DTLS ?? [])[0]; // newest first
    const code = String(latest?.INTRANSIT_STATUS_CODE || '').toUpperCase();
    const text = GATI_TEXT[code] ?? (latest?.INTRANSIT_STATUS || d.DOCKET_STATUS || null);
    const label = `${d.DOCKET_STATUS || latest?.INTRANSIT_STATUS || 'Booked'}${latest?.INTRANSIT_LOCATION ? ` — ${latest.INTRANSIT_LOCATION}` : ''}${latest?.REASON_DESC ? ` (${latest.REASON_DESC})` : ''} (Gati)`;
    const derived = text ? deriveStatusFromBd(s.statusCode, text) : null;
    await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus: label, ...(derived ? { statusCode: derived.statusCode, status: derived.status, statusAt: new Date() } : {}) } });
    return { awb, docket: s.forwardingAwb, status: label, statusCode: derived?.statusCode ?? s.statusCode, pod: d.POD || null, tracking: d };
  }

  async autoSync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 864e5) }, forwardingAwb: { not: null },
          AND: [{ OR: [{ vendor: { equals: 'GATI', mode: 'insensitive' } }, { vendor: { contains: 'ALLCARGO', mode: 'insensitive' } }] }, { OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] }],
        },
        select: { awb: true }, take: 300,
      });
      for (const r of rows) {
        try { await this.syncTracking(r.awb); } catch { /* keep going */ }
        await new Promise((res) => setTimeout(res, 300));
      }
    } finally {
      this.syncing = false;
    }
  }
}
