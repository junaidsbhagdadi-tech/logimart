import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveStatusFromBd } from '../bluedart/bd-status';
import { cityName } from '../../common/place-name';

/**
 * Gati / Allcargo — "ACL2CUST" single-endpoint API (SOP "Single Endpoint API Architecture Using Request IDs",
 * 20-08-2026). Every call is a POST to ONE URL; the `requid` header picks the function and each requid has its
 * own fixed `authorization` key. `custCode` header = the ENCRYPTED customer code; `gtoken` = the token from
 * A2C01 (username/password login, valid 24 h). Env (droplet .env):
 *   GATI_ENV               uat | prod (default prod). Prod URL is only enabled by Gati after UAT sign-off.
 *   GATI_CUST_CODE         8-digit customer code (Tuvas 30816701)
 *   GATI_ENC_CUST_CODE     encrypted customer code (header custCode)                         SECRET
 *   GATI_USERNAME / GATI_PASSWORD   API login for A2C01 (issued by Gati — NOT the portal login)  SECRET
 *   GATI_TRACK_TOKEN       16-char tracking token (A2C04 body "token")                         SECRET
 *   GATI_AUTH_KEYS         optional JSON {requid: key} overriding the per-requid authorization keys
 *   GATI_DEFAULT_GOODS_CODE  goods code when the content doesn't say (e.g. 33 MISC MANUFACTURED)
 *
 * Booking: pincode check (A2C05) → register the pickup point (A2C06, once) → docket (A2C07) → package series
 * (A2C08) → post docket (A2C02). Docket = forwardingAwb, package nos = box ids. Prints: A2C10 / A2C11.
 */
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const UAT = /^uat$/i.test(env('GATI_ENV', 'prod'));
const URL = UAT ? 'https://pg-uat.gati.com/ACL2CUST/ACLWebservices.jsp' : 'https://justi.gati.com/ACL2CUST/ACLWebservices.jsp';
const G = {
  cust: env('GATI_CUST_CODE'),
  enc: env('GATI_ENC_CUST_CODE'),
  user: env('GATI_USERNAME'),
  pass: env('GATI_PASSWORD'),
  trackToken: env('GATI_TRACK_TOKEN'),
  goodsDefault: env('GATI_DEFAULT_GOODS_CODE'),
};
// Per-request-ID authorization keys, as given in Gati's SOP (verified on UAT: A2C01's key is accepted only for
// A2C01, a random value → "Invalid Header Details"). Override with GATI_AUTH_KEYS if Gati issues others for prod.
const AUTH_KEYS: Record<string, string> = {
  A2C01: '01f0-0cdc-0b5e-cb23-01f0213c', A2C02: '9021-b0d3-5532-a7c2-9021c0fc', A2C03: '7f0a-1cfc-1abf-3b42-7f0ae0db',
  A2C04: '8984-0ef3-c9c1-aac9-8984311b', A2C05: 'a90b-b1ef-da12-7a00-a90b3a83', A2C06: 'acce-368c-edd3-0933-acce43ef',
  A2C07: 'edd3-368c-edd3-6267-acce19ef', A2C08: 'hdjs-368c-skp2-0933-flje43ef', A2C09: 'dsl9-sja6-edd3-0925-soeb25ef',
  A2C10: 'bp41-sja6-edd3-0379-soeb25ed', A2C11: 'kb72-sja6-edd3-6720-soeb25sm',
  ...(() => { try { return JSON.parse(env('GATI_AUTH_KEYS', '{}')); } catch { return {}; } })(),
};
export const gatiConfigured = () => !!(G.cust && G.enc && G.user && G.pass);
export const isGatiVendor = (v?: string | null) => /^GATI$|ALLCARGO/i.test(String(v ?? '').trim());

// Goods codes (Gati cargo class) by keyword in the goods description.
const GOODS: [RegExp, string][] = [
  [/GARMENT|APPAREL|SHIRT|CLOTH|FABRIC|TEXTILE/i, '37'], [/SAREE/i, '507'], [/AUTO|SPARE|VEHICLE/i, '14'],
  [/LAPTOP/i, '208'], [/COMPUTER|PRINTER/i, '19'], [/ELECTRONIC|MOBILE|PHONE|TV/i, '24'], [/ELECTRICAL|CABLE|WIRE/i, '25'],
  [/PHARMA|MEDIC|DRUG|TABLET/i, '23'], [/COSMETIC/i, '20'], [/CHEMICAL/i, '16'], [/MACHINE|MACHINERY/i, '32'],
  [/FOOD|SNACK|SPICE|GROCER/i, '402'], [/BOOK/i, '601'], [/STATIONER/i, '603'], [/FURNITURE|WOOD/i, '42'],
  [/GLASS/i, '30'], [/PLASTIC/i, '406'], [/TOY|BABY/i, '414'], [/HOUSEHOLD|HOUSE HOLD/i, '401'], [/STEEL|IRON|METAL/i, '306'],
];

// Gati transit status code → wording our shared carrier mapper understands (null = no milestone change).
const GATI_TEXT: Record<string, string | null> = {
  DCRE: null, DCRB: null, PAC: null, NAS: null, ACP: null, RPOP: null, POP: null,
  CLO: 'PICKED UP', TCSOU: 'IN TRANSIT', TCAER: 'IN TRANSIT', TCSEO: 'IN TRANSIT',
  DKTAD: 'REACHED DESTINATION', TCADO: 'REACHED DESTINATION', DPDCC: 'OUT FOR DELIVERY',
  DDLVD: 'DELIVERED', DDPVD: 'DELIVERED', DUNDL: 'UNDELIVERED', DRTO: 'RTO', REDRTO: 'RTO', CAN: 'CANCELLED', RCN: null, REJ: null,
};

const p2 = (n: number) => String(n).padStart(2, '0');
/** "YYYY-MM-DD HH:mm:ss" in IST — the requestDt format of the SOP. */
function istDt(d = new Date()) {
  const t = new Date(d.getTime() + 330 * 60000);
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
}
const cut = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const mobile = (...vals: any[]) => vals.map((v) => String(v ?? '').replace(/\D/g, '').slice(-10)).find((v) => v.length === 10) ?? '';
const ok = (r: any) => String(r?.result ?? '').toLowerCase().startsWith('succes');
const first = (d: any) => (Array.isArray(d) ? d[0] : d) ?? {};
const errOf = (r: any) => String(r?.sErrMsg || first(r?.details)?.errmsg || r?.raw || '').trim() || JSON.stringify(r).slice(0, 200);

@Injectable()
export class GatiService implements OnModuleInit {
  private readonly log = new Logger('Gati');
  private syncing = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const mins = Number(process.env.GATI_SYNC_INTERVAL_MIN ?? 30);
    if (!G.trackToken || !gatiConfigured() || !(mins > 0)) return;
    const t = setInterval(() => this.autoSync().catch((e) => this.log.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (t as any).unref?.();
  }

  status() {
    return {
      configured: gatiConfigured(), env: UAT ? 'UAT' : 'PRODUCTION', api: 'ACL2CUST single endpoint',
      custCode: G.cust || 'missing', encCustCode: G.enc ? 'set' : 'missing', login: G.user && G.pass ? 'set' : 'missing',
      trackToken: G.trackToken ? 'set' : 'missing', defaultGoodsCode: G.goodsDefault || 'not set',
    };
  }

  private ensure() {
    if (!gatiConfigured()) throw new BadRequestException('Gati not configured — set GATI_CUST_CODE, GATI_ENC_CUST_CODE, GATI_USERNAME and GATI_PASSWORD on the server.');
  }

  private async post(requid: string, body: unknown, gtoken?: string): Promise<any> {
    const headers: Record<string, string> = { requid, authorization: AUTH_KEYS[requid] ?? '', 'Content-Type': 'application/json', custCode: G.enc };
    if (gtoken) headers.gtoken = gtoken;
    const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    const ct = res.headers.get('content-type') || '';
    if (/pdf/i.test(ct)) return { result: 'successful', pdf: Buffer.from(await res.arrayBuffer()) };
    const text = (await res.text()).trim();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
    if (!res.ok) throw new BadRequestException(`Gati ${res.status} (${requid}): ${text.slice(0, 250)}`);
    return data;
  }

  /** gtoken from A2C01, cached in Postgres for 23 h (Gati: valid 24 h). */
  private async token(force = false): Promise<string> {
    this.ensure();
    if (!force) {
      const c = await this.prisma.integrationToken.findUnique({ where: { provider: 'GATI' } }).catch(() => null);
      if (c && c.expiresAt.getTime() > Date.now() + 60_000) return c.token;
    }
    const r = await this.post('A2C01', { username: G.user, password: G.pass });
    const tok = String(first(r?.details)?.TOKEN ?? '').trim();
    if (!ok(r) || !tok) throw new BadRequestException(`Gati login failed: ${errOf(r)}`);
    const expiresAt = new Date(Date.now() + 23 * 3600_000);
    await this.prisma.integrationToken.upsert({ where: { provider: 'GATI' }, update: { token: tok, expiresAt }, create: { provider: 'GATI', token: tok, expiresAt } });
    return tok;
  }

  /** Authenticated call; a rejected/expired gtoken is refreshed once. */
  private async call(requid: string, body: Record<string, any>) {
    let r = await this.post(requid, body, await this.token());
    if (!ok(r) && /gtoken|token/i.test(String(r?.sErrMsg ?? ''))) r = await this.post(requid, body, await this.token(true));
    return r;
  }

  /** Serviceability of a pincode → Gati location(s) (A2C05). */
  async pincode(pin: string) {
    return this.call('A2C05', { requestDt: istDt(), pinCode: String(pin) });
  }

  /** Register the pickup address as a customer "vendor" (A2C06, once) — returns its 15-digit code. */
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
    const city = await cityName(this.prisma, pin, s.shipperCity, c.city);
    const r = await this.call('A2C06', {
      custCode: G.cust, requestDt: istDt(),
      details: [{
        custVendorCode: code, custVendorName: cut(s.shipperName || c.legalName, 50),
        vendorAdd1: cut(address.slice(0, 50), 50), vendorAdd2: cut(address.slice(50, 100) || city || '.', 50), vendorAdd3: cut(address.slice(100, 150), 50),
        vendorCity: cut(city, 20), vendorPhoneNo: phone, vendorPincode: pin, vendorEmail: cut(String(c.contactEmail || '').split(/[,;]/)[0], 50),
        vendorReceiverFlag: 'V', vendorTinno: '', addressType: '', uniqueNo: '', vendorGSTNO: s.consignorGstin || c.gstin || '',
      }],
    });
    const msg = String(first(r?.details)?.errmsg ?? r?.sErrMsg ?? '');
    if (!ok(r) && !/exist|already/i.test(msg)) throw new BadRequestException(`Gati could not register the pickup point: ${msg || errOf(r)}`);
    await this.prisma.gatiVendor.upsert({ where: { code }, update: {}, create: { code, clientId: s.clientId ?? null, pincode: pin, address } });
    return code;
  }

  /** Hand a shipment to Gati: pincode check → vendor → docket → package series → post docket (A2C02). */
  async handoff(awb: string) {
    this.ensure();
    const s: any = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: { orderBy: { sequenceNo: 'asc' } } } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    if (s.forwardingAwb) throw new BadRequestException(`${awb} already has a carrier docket (${s.forwardingAwb}).`);
    const value = Number(s.declaredValue ?? s.shipmentValue ?? 0);
    if (!(value > 0)) throw new BadRequestException('Gati needs the declared goods value (cannot be 0) — add it on the AWB.');
    const recvPhone = mobile(s.consigneePhone);
    const recvAddr = cut(s.consigneeAddress, 200);
    const missing = [!s.consigneeName && 'consignee name', !recvAddr && 'consignee address', !/^\d{6}$/.test(String(s.destPincode || '')) && 'consignee pincode', !recvPhone && 'consignee 10-digit mobile'].filter(Boolean);
    if (missing.length) throw new BadRequestException(`Gati needs: ${missing.join(', ')} — fix them on the AWB (Edit AWB).`);
    const goodsCode = GOODS.find(([re]) => re.test(String(s.goodsDesc || '')))?.[1] || G.goodsDefault;
    if (!goodsCode) throw new BadRequestException('Gati needs a goods code — put the content on the AWB (e.g. "garments", "auto parts") or set GATI_DEFAULT_GOODS_CODE.');

    // Step 1 — pincode validation before a docket is spent. Only a clear "no service" blocks.
    const pr: any = await this.pincode(String(s.destPincode)).catch(() => null);
    const locs = pr ? [pr.details].flat().filter(Boolean) : null;
    if (pr && (ok(pr) ? !locs?.length : /not\s*servic|invalid\s*pin/i.test(String(pr.sErrMsg)))) {
      throw new BadRequestException(`Gati does not serve consignee pincode ${s.destPincode} — choose another carrier.`);
    }
    const locationCode = String(first(locs)?.locationCode ?? '');

    const recvCity = await cityName(this.prisma, String(s.destPincode), s.consigneeCity);
    const vendorCode = await this.ensureVendor(s);
    const pieces = s.pieces.length ? s.pieces : [{ deadKg: s.totalDeadKg || 1 }];

    const dk = await this.call('A2C07', { custCode: G.cust, requestDt: istDt() }); // 1 docket per call
    const docket = String(first(dk?.details)?.docketNo ?? '').trim();
    if (!ok(dk) || !/^\d{9}$/.test(docket)) throw new BadRequestException(`Gati gave no docket number (${docket || errOf(dk)}) — ask Allcargo to allocate dockets to the account.`);
    const ps = await this.call('A2C08', { docketNo: docket, noOfPkgs: String(pieces.length), requestDt: istDt(), custCode: G.cust });
    const from = Number(first(ps?.details)?.frmNo);
    if (!ok(ps) || !(from > 0)) throw new BadRequestException(`Gati package numbers unavailable: ${errOf(ps)} — ask Allcargo to allocate package series.`);
    const pkgNos = pieces.map((_: any, i: number) => from + i);

    const toPay = String(s.paymentTerm).toUpperCase() === 'TO_PAY';
    const dod = !!s.isDod && Number(s.dodAmount) > 0;
    const c = s.client ?? {};
    const body = {
      custCode: G.cust, shipperCode: G.cust, docketNo: docket, goodsCode, goodsDesc: cut(s.goodsDesc || 'General goods', 200),
      declCargoVal: Number(value.toFixed(2)), actualWt: Number(Number(s.totalDeadKg || 0.5).toFixed(2)), chargedWt: Number(Number(s.chargeWeight || s.totalDeadKg || 0.5).toFixed(2)),
      orderNo: cut(s.custInvoiceNo || s.referenceNo || s.awb, 20),
      codAmt: dod ? Number(s.dodAmount).toFixed(2) : '0', codInFavourOf: dod ? 'S' : 'G',
      receiverCode: '99999', receiverName: cut(s.consigneeName, 50),
      receiverAdd1: cut(recvAddr.slice(0, 50), 50), receiverAdd2: cut(recvAddr.slice(50, 100) || recvCity, 50),
      receiverAdd3: cut(recvAddr.slice(100, 150), 50), receiverAdd4: cut(recvAddr.slice(150, 200), 50),
      receiverCity: cut(recvCity, 20), receiverPhoneNo: recvPhone, receiverMobileNo: recvPhone,
      receiverEmail: 'na@na.com', receiverPinCode: String(s.destPincode), ReceiverGSTINNo: s.consigneeGstin || '',
      noOfPkgs: String(pieces.length), fromPkgNo: pkgNos[0], toPkgNo: pkgNos[pkgNos.length - 1],
      pkgInfo: pieces.map((pc: any, i: number) => ({ pkgNo: pkgNos[i], pkgLn: Number(pc.lengthCm || 1), pkgBr: Number(pc.widthCm || 1), pkgHt: Number(pc.heightCm || 1), pkgWt: Number(pc.deadKg || 0.5), custPkgNo: '' })),
      prodServCode: /AIR/i.test(String(s.serviceMode)) ? '2' : '1',
      bookingBasis: toPay ? '4' : '2', // 2 = contractual (our account), 4 = FOD (to-pay)
      UOM: 'CC', custVendCode: vendorCode, deliveryStn: '', locationCode, instructions: '', CustDeliveyDate: '',
      consignorGSTINNo: s.consignorGstin || c.gstin || '',
      pickupContactName: cut(s.shipperContact || c.contactName || s.shipperName || c.legalName, 50),
      pickupContactNumber: mobile(s.shipperMobile, s.shipperContact, c.contactPhone, c.tel1),
      pickupRequestDt: istDt(),
      ...(s.ewbNo ? { EWAYBILL: String(s.ewbNo), ...(s.ewbValidUpto ? { EWB_EXP_DT: istDt(new Date(s.ewbValidUpto)).slice(0, 10) } : {}) } : {}),
    };
    const r = await this.call('A2C02', body);
    if (!ok(r)) throw new BadRequestException(`Gati refused ${awb} (docket ${docket}): ${errOf(r)}`);
    await this.prisma.$transaction([
      this.prisma.shipment.update({ where: { id: s.id }, data: { forwardingAwb: docket, vendor: s.vendor || 'GATI', bdStatus: 'Docket created (Gati)', bdHandedAt: new Date() } }),
      ...s.pieces.map((pc: any, i: number) => this.prisma.shipmentPiece.update({ where: { id: pc.id }, data: { carrierChildId: String(pkgNos[i]) } })),
    ]);
    return { awb, docket, packages: pkgNos.map(String), response: r };
  }

  /** Docket copy (A2C10) or package stickers (A2C11) as a PDF. */
  async pdf(docket: string, kind: 'docket' | 'stickers'): Promise<Buffer> {
    const r = await this.call(kind === 'docket' ? 'A2C10' : 'A2C11', { requestDt: istDt(), docketNo: String(docket), outPutType: 'BASE64' });
    if (r?.pdf) return r.pdf;
    // BASE64 output: take the longest base64-looking string anywhere in the response.
    let best = '';
    const walk = (v: any) => { if (typeof v === 'string') { const t = v.replace(/^data:[^,]+,/, ''); if (t.length > best.length && /^[A-Za-z0-9+/=\s]+$/.test(t)) best = t; } else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(r);
    if (best.length < 100) throw new BadRequestException(`Gati gave no ${kind} PDF: ${errOf(r)}`);
    return Buffer.from(best.replace(/\s+/g, ''), 'base64');
  }

  async cancel(awb: string, reason = 'Cancelled by customer') {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, forwardingAwb: true, referenceNo: true, custInvoiceNo: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No Gati docket on ${awb} to cancel.`);
    const r = await this.call('A2C09', { requestDt: istDt(), docketNo: s.forwardingAwb, orderNo: cut(s.custInvoiceNo || s.referenceNo || awb, 20), canReason: cut(reason, 100) });
    const msg = String(first(r?.details)?.errmsg ?? r?.sErrMsg ?? '');
    if (!/cancel/i.test(msg)) throw new BadRequestException(`Gati did not cancel docket ${s.forwardingAwb}: ${msg || errOf(r)}`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { bdStatus: 'CANCELLED (Gati)' } });
    return { awb, cancelled: s.forwardingAwb };
  }

  async track(docket: string) {
    if (!G.trackToken) throw new BadRequestException('Set GATI_TRACK_TOKEN (16-character tracking token).');
    return this.call('A2C04', { docketNo: String(docket), token: G.trackToken, requestDt: istDt() });
  }

  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true, statusCode: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No Gati docket on ${awb} to track.`);
    const r = await this.track(s.forwardingAwb);
    const d = first(r?.details);
    if (!ok(r) || !d?.DOCKET_NUMBER || d.errmsg) throw new BadRequestException(`Gati tracking: ${d?.errmsg || errOf(r)}`);
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
