import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DELHIVERY, DelAccount, delAccountFor, delAccounts, delConfigured } from './delhivery.config';
import { deriveStatusFromBd } from '../bluedart/bd-status';
import { cityName } from '../../common/place-name';

/** Delhivery's /manifest form fields are parsed as PYTHON literals (their sample: `"master": False`) —
 *  JSON's true/false/null makes the field invalid ("value is not a valid list"). Serialise accordingly. */
const GST_STATES: Record<string, string> = { '07': 'Delhi', '27': 'Maharashtra', '29': 'Karnataka', '33': 'Tamil Nadu', '36': 'Telangana', '24': 'Gujarat', '09': 'Uttar Pradesh', '06': 'Haryana', '19': 'West Bengal', '32': 'Kerala', '08': 'Rajasthan', '03': 'Punjab', '23': 'Madhya Pradesh', '21': 'Odisha', '10': 'Bihar', '37': 'Andhra Pradesh' };
const stateFromGst = (g?: string) => (g ? GST_STATES[String(g).slice(0, 2)] : undefined);

function pyLit(v: any): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(pyLit).join(', ')}]`;
  return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyLit(x)}`).join(', ')}}`;
}

/**
 * Delhivery B2B / LTL API. Auth: POST /ums/login {username,password} → Bearer token (cached in
 * IntegrationToken, re-login on 401). Consignment = LR (Lorry Receipt); creating one is the async
 * /manifest job. Endpoints wired: serviceability, TAT, freight estimate, manifest (create LR) +
 * status, LR track, shipping label, create/cancel pickup, LR cancel.
 */
@Injectable()
export class DelhiveryService implements OnModuleInit {
  private readonly log = new Logger('Delhivery');
  private syncing = false;
  /** The Delhivery account (vendor code) the current operation runs under — set by withAccount(). */
  private readonly acctCtx = new AsyncLocalStorage<DelAccount>();
  constructor(private readonly prisma: PrismaService) {}

  private acct(): DelAccount { return this.acctCtx.getStore() ?? delAccounts()[0]; }
  /** Run fn under the account that matches this shipment's vendor code. */
  private withAccount<T>(vendor: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    return this.acctCtx.run(delAccountFor(vendor), fn);
  }
  private tokKey(kind: '' | '_LOGIN_FAIL') { const c = this.acct().code; return `DELHIVERY${kind}${c === 'DLY' ? '' : ':' + c}`; }

  /** Keep Delhivery LR tracking live (DELHIVERY_SYNC_INTERVAL_MIN, default 15; 0 = off). */
  onModuleInit() {
    const mins = Number(process.env.DELHIVERY_SYNC_INTERVAL_MIN ?? 15);
    if (!delConfigured() || !(mins > 0)) return;
    const t = setInterval(() => this.autoSync().catch((e) => this.log.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (t as any).unref?.();
    this.log.log(`Delhivery tracking auto-sync every ${mins} min.`);
  }

  /** Sync open Delhivery shipments (LR on forwardingAwb) booked in the last 30 days. Stops at the
   *  first login failure so a bad password doesn't hammer Delhivery 600 times a pass. */
  async autoSync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 864e5) },
          OR: [{ forwardingAwb: { not: null } }, { bdStatus: { startsWith: 'Delhivery job' } }],
          AND: [
            { OR: [{ vendor: { startsWith: 'DLY', mode: 'insensitive' } }, { vendor: { contains: 'DELHIVERY', mode: 'insensitive' } }] },
            { OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] },
          ],
        },
        select: { awb: true }, orderBy: { createdAt: 'desc' }, take: 300,
      });
      for (const r of rows) {
        try { await this.syncTracking(r.awb); } catch { /* not an LR / not found — keep going */ }
        await new Promise((res) => setTimeout(res, 400));
      }
    } finally {
      this.syncing = false;
    }
  }

  private ensure() {
    if (!delConfigured()) {
      throw new BadRequestException('Delhivery not configured — set DELHIVERY_USERNAME, DELHIVERY_PASSWORD, DELHIVERY_BASE_URL (+ DELHIVERY_PICKUP_NAME for hand-off).');
    }
  }

  status() {
    return {
      configured: delConfigured(),
      baseUrl: DELHIVERY.baseUrl || 'missing',
      username: DELHIVERY.username ? 'set' : 'missing',
      password: DELHIVERY.password ? 'set' : 'missing',
      pickupName: DELHIVERY.pickupName || 'missing',
      accounts: delAccounts().map((a) => `${a.code}=${a.username || 'missing'}`).join(', '),
      env: /-dev\./.test(DELHIVERY.baseUrl) ? 'STAGING' : 'PRODUCTION',
    };
  }

  /** UMS login → Bearer token, cached in Postgres (re-login early or on force/401). */
  private async token(force = false): Promise<string> {
    this.ensure();
    // A wrong password LOCKS the Delhivery user for 10 minutes — after a failed login, don't try again
    // for 30 minutes (shared across instances via Postgres), so auto-sync can't keep it locked.
    const A = this.acct();
    const pause = await this.prisma.integrationToken.findUnique({ where: { provider: this.tokKey('_LOGIN_FAIL') } });
    if (pause && pause.expiresAt.getTime() > Date.now()) {
      throw new BadRequestException(`Delhivery login paused until ${new Date(pause.expiresAt.getTime() + 330 * 60000).toISOString().slice(11, 16)} IST after a failed login on ${A.code} (${pause.token}). Fix that account's username / password meanwhile.`);
    }
    if (!force) {
      const cached = await this.prisma.integrationToken.findUnique({ where: { provider: this.tokKey('') } });
      if (cached && cached.expiresAt.getTime() > Date.now() + 60_000) return cached.token;
    }
    const res = await fetch(`${DELHIVERY.baseUrl}/ums/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: A.username, password: A.password }),
    });
    const text = await res.text();
    if (!res.ok) {
      const until = new Date(Date.now() + 30 * 60_000);
      const why = text.slice(0, 120);
      await this.prisma.integrationToken.upsert({ where: { provider: this.tokKey('_LOGIN_FAIL') }, update: { token: why, expiresAt: until }, create: { provider: this.tokKey('_LOGIN_FAIL'), token: why, expiresAt: until } });
      throw new BadRequestException(`Delhivery login failed for ${A.code} (${res.status}): ${text.slice(0, 200)}`);
    }
    await this.prisma.integrationToken.deleteMany({ where: { provider: this.tokKey('_LOGIN_FAIL') } });
    let token = '';
    try { const j = JSON.parse(text); token = j.token || j.jwt || j.access_token || j.data?.token || j.data?.jwt || j.data?.access_token || ''; } catch { /* non-JSON */ }
    if (!token) throw new BadRequestException('Delhivery login returned no token.');
    const expiresAt = new Date(Date.now() + 23 * 3600 * 1000); // Delhivery tokens live 24h; a 401 forces re-login anyway
    await this.prisma.integrationToken.upsert({
      where: { provider: this.tokKey('') },
      update: { token, expiresAt },
      create: { provider: this.tokKey(''), token, expiresAt },
    });
    return token;
  }

  /** Authenticated call. JSON by default; pass `form` for the multipart /manifest. Retries once on 401. */
  private async req(path: string, init: RequestInit = {}, form?: FormData): Promise<any> {
    const doFetch = async (tok: string) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${tok}`, Accept: 'application/json', ...(init.headers as any || {}) };
      if (!form && init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      const url = path.startsWith('http') ? path : `${DELHIVERY.baseUrl}${path}`;
      return fetch(url, { ...init, headers, ...(form ? { body: form as any } : {}) });
    };
    let res = await doFetch(await this.token());
    if (res.status === 401) res = await doFetch(await this.token(true)); // token expired → re-login once
    const text = await res.text();
    let data: any; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new BadRequestException(`Delhivery ${res.status} (${path}): ${text.slice(0, 300)}`);
    return data;
  }

  // ---- read-only lookups ----

  /** Is a destination pincode serviceable (optionally for a weight in kg)? */
  serviceability(pincode: string, weightKg?: number) {
    return this.req(`/pincode-service/${encodeURIComponent(pincode)}${weightKg ? `?weight=${weightKg}` : ''}`, { method: 'GET' });
  }

  /** Expected TAT for a lane. mot: S=Surface, A=Air. */
  tat(originPin: string, destPin: string, mot: 'S' | 'A' = 'S') {
    return this.req(`/tat/estimate?origin_pin=${encodeURIComponent(originPin)}&destination_pin=${encodeURIComponent(destPin)}&mot=${mot}&pdt=B2B`, {
      method: 'GET',
      headers: { 'X-Request-Id': `logimart-${Date.now()}` },
    });
  }

  /** Freight estimate for a prospective shipment. */
  freightEstimate(dto: { sourcePin: string; destPin: string; weightKg: number; dimensions?: { length_cm: number; width_cm: number; height_cm: number; box_count: number }[]; invAmount?: number; paymentMode?: string; freightMode?: string; rovInsurance?: boolean }) {
    return this.req('/freight/estimate', {
      method: 'POST',
      body: JSON.stringify({
        dimensions: dto.dimensions?.length ? dto.dimensions : [{ length_cm: 10, width_cm: 10, height_cm: 10, box_count: 1 }],
        weight_g: Math.max(1, Math.round((dto.weightKg || 0.5) * 1000)),
        cheque_payment: false,
        source_pin: dto.sourcePin,
        consignee_pin: dto.destPin,
        payment_mode: dto.paymentMode || 'prepaid',
        inv_amount: dto.invAmount ?? 0,
        freight_mode: dto.freightMode || 'fop',
        rov_insurance: dto.rovInsurance ?? false,
      }),
    });
  }

  // ---- hand-off (create LR via the async manifest job) ----

  /**
   * Hand a Logimart shipment to Delhivery: submit the /manifest job, poll for the LR number, and
   * store it as the forwarding AWB. `pickupName` overrides the default registered warehouse.
   */
  async createManifest(awb: string, pickupName?: string) {
    const v = await this.prisma.shipment.findUnique({ where: { awb }, select: { vendor: true } });
    return this.withAccount(v?.vendor, () => this.createManifestAs(awb, pickupName));
  }

  private async createManifestAs(awb: string, pickupName?: string) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: true } }) as any;
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    // Pickups can be from anywhere: the shipper's address is registered as a Delhivery warehouse (once).
    const pickup = (pickupName || '').trim() || await this.ensureWarehouse(s);

    const toPay = String(s.paymentTerm).toUpperCase() === 'TO_PAY';
    const weightG = Math.max(1, Math.round(Number(s.chargeWeight ?? s.totalDeadKg ?? 0.5) * 1000));
    const invAmt = Number(s.shipmentValue ?? s.declaredValue ?? 0);
    const dims = (s.pieces ?? [])
      .filter((p: any) => p.lengthCm && p.widthCm && p.heightCm)
      .map((p: any) => ({ box_count: 1, length: Number(p.lengthCm), width: Number(p.widthCm), height: Number(p.heightCm) }));

    const fd = new FormData();
    fd.append('lrn', ''); // blank → Delhivery assigns the LR
    fd.append('pickup_location_name', pickup);
    fd.append('payment_mode', 'prepaid'); // Logimart bills the customer; goods are not COD
    fd.append('cod_amount', '0');
    fd.append('weight', String(weightG));
    fd.append('dropoff_location', pyLit({
      consignee_name: s.consigneeName ?? '', address: s.consigneeAddress ?? '', city: await cityName(this.prisma, String(s.destPincode ?? ''), s.consigneeCity),
      state: s.consigneeState ?? '', zip: s.destPincode ?? '', phone: s.consigneePhone ?? '', email: '',
    }));
    fd.append('rov_insurance', invAmt > 50000 ? 'True' : 'False');
    // inv_num: letters, digits, "/" and "-" only (Delhivery regex).
    const invNum = String(s.custInvoiceNo || s.referenceNo || s.awb).replace(/[^A-Za-z0-9/-]+/g, '-').replace(/^-+|-+$/g, '') || String(s.awb);
    fd.append('invoices', pyLit([{ ewaybill: s.ewbNo ?? '', inv_num: invNum, inv_amt: invAmt, inv_qr_code: '' }]));
    // Delhivery requires the goods' invoice copy: send the invoice attached to the AWB (Documents).
    const inv = await this.invoiceCopy(s.id);
    if (!inv) throw new BadRequestException(`Delhivery needs the customer's invoice copy — attach it on AWB ${awb} (Attachments: PDF / photo) and hand off again.`);
    fd.append('doc_data', pyLit([{ doc_type: 'INVOICE_COPY', doc_meta: { invoice_num: [invNum] } }]));
    fd.append('doc_file', new Blob([new Uint8Array(inv.data)], { type: inv.mimeType }), inv.filename);
    fd.append('shipment_details', pyLit([{ order_id: String(s.awb), box_count: Number(s.pieceCount ?? 1), description: s.goodsDesc ?? 'Goods', weight: weightG, waybills: [], master: false }]));
    if (dims.length) fd.append('dimensions', pyLit(dims));
    // First mile, chosen per AWB: Delhivery PICKS UP from the pickup address (customer's place or our warehouse —
    // whatever the AWB's pickup address is), or we SELF-DROP at their hub. Unset → DELHIVERY_FM_PICKUP_DEFAULT (false).
    const fmPickup = s.fmPickup ?? /^(1|true|yes)$/i.test(String(process.env.DELHIVERY_FM_PICKUP_DEFAULT ?? 'false'));
    fd.append('fm_pickup', fmPickup ? 'True' : 'False'); // + an explicit pickup request below
    fd.append('freight_mode', toPay ? 'fod' : 'fop'); // fod = freight on delivery (To-Pay), fop = freight on payer
    // Billing party = the Delhivery account holder (us), with our GST/PAN — Delhivery invoices us, not the
    // end customer. The goods' owner goes in as the consignor.
    const bill = await this.billingEntity();
    fd.append('billing_address', pyLit({
      name: bill.legalName, company: bill.legalName, consignor: s.shipperName || s.client?.legalName || bill.legalName,
      address: bill.address, city: bill.city, state: bill.state, pin: bill.pin, phone: bill.phone,
      ...(bill.gstin ? { gst_number: bill.gstin } : {}), ...(bill.pan ? { pan_number: bill.pan } : {}),
    }));

    let resp: any;
    try {
      resp = await this.req('/manifest', { method: 'POST' }, fd);
    } catch (e: any) {
      // A pickup point registered moments ago takes a few minutes to activate at Delhivery.
      if (/has not been configured/i.test(String(e?.message))) {
        const wh = await this.prisma.delWarehouse.findUnique({ where: { name: pickup } }).catch(() => null);
        if (wh && Date.now() - wh.createdAt.getTime() < 30 * 60_000) {
          throw new BadRequestException(`Delhivery is still activating the new pickup point ${pickup} (registered ${Math.round((Date.now() - wh.createdAt.getTime()) / 60000)} min ago) — hand off again in a few minutes.`);
        }
      }
      throw e;
    }
    const jobId = resp?.job_id ?? resp?.jobId ?? resp?.data?.job_id ?? null;
    // The manifest is async — poll for the LR (data.lrnum); if it isn't ready yet, park the job id and let
    // tracking sync pick the LR up later.
    let lrn: string | null = null;
    if (jobId) {
      for (let i = 0; i < 10 && !lrn; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        lrn = (await this.applyManifestJob(s.id, String(jobId)).catch(() => null))?.lrn ?? null;
      }
      if (!lrn) await this.prisma.shipment.update({ where: { id: s.id }, data: { vendor: s.vendor || 'DLY', bdStatus: `Delhivery job ${jobId}`, bdHandedAt: new Date() } });
    }
    // First mile = Delhivery pickup → raise their pickup request for the pickup point (fm_pickup alone doesn't).
    if (fmPickup) {
      try {
        const pk = await this.pickupFor(pickup, Number(s.pieceCount || 1));
        await this.prisma.shipment.update({ where: { id: s.id }, data: { bdPickupToken: pk.pickupId } });
      } catch (e: any) {
        await this.prisma.shipment.update({ where: { id: s.id }, data: { exceptionFlag: `Delhivery pickup request failed: ${String(e?.message || e).slice(0, 180)}` } }).catch(() => {});
      }
    }
    return { awb, lrn, jobId, response: resp };
  }

  /** Delhivery pickup slot: booked before 1 PM IST → today 14:00, else tomorrow 11:00. */
  private pickupSlot() {
    const ist = new Date(Date.now() + 330 * 60000);
    const late = ist.getUTCHours() >= 13;
    const d = new Date(ist.getTime() + (late ? 864e5 : 0));
    return { date: d.toISOString().slice(0, 10), startTime: late ? '11:00:00' : '14:00:00' };
  }

  /** Raise a Delhivery pickup request at a registered pickup point (current account). Returns their id. */
  private async pickupFor(warehouse: string, packages: number) {
    const r: any = await this.createPickup({ warehouse, ...this.pickupSlot(), packages: Math.max(1, packages) });
    const id = r?.pickup_id ?? r?.data?.pickup_id ?? r?.pr_id ?? r?.request_id ?? r?.data?.request_id ?? r?.id ?? r?.data?.id;
    if (id == null && (r?.success === false || r?.error)) throw new BadRequestException(`Delhivery refused the pickup: ${JSON.stringify(r?.error ?? r?.message ?? r).slice(0, 200)}`);
    return { pickupId: String(id ?? 'requested'), response: r };
  }

  /** A pickup request from the Pickups page → register its address as a pickup point and book the pickup. */
  async schedulePickupRequest(p: { vendor?: string | null; client: any; address: string; pincode: string; city?: string | null; contactName?: string | null; contactPhone?: string | null; boxes?: number }) {
    return this.withAccount(p.vendor, async () => {
      const wh = await this.ensureWarehouse({ client: p.client, shipperName: p.contactName || p.client?.legalName, shipperAddress1: p.address, shipperPincode: p.pincode, shipperCity: p.city, shipperMobile: p.contactPhone });
      return { warehouse: wh, ...(await this.pickupFor(wh, Number(p.boxes || 1))) };
    });
  }

  /** Read a manifest job; once Complete, store the LR (forwardingAwb) and the per-box waybills. */
  private async applyManifestJob(shipmentId: bigint, jobId: string): Promise<{ lrn: string | null; status: string | null }> {
    const st: any = await this.manifestStatus(jobId);
    const d = st?.data ?? st;
    const lrn: string | null = d?.lrnum ? String(d.lrnum) : (d?.lrn ? String(d.lrn) : null);
    const status: string | null = d?.status ?? null;
    if (!lrn) {
      if (/fail|error|reject/i.test(String(status))) {
        await this.prisma.shipment.update({ where: { id: shipmentId }, data: { bdStatus: `Delhivery manifest ${status}: ${JSON.stringify(d?.error ?? d?.message ?? '').slice(0, 150)}` } });
      }
      return { lrn: null, status };
    }
    const waybills: string[] = Array.isArray(d?.waybills) ? d.waybills.map(String) : [];
    const pieces = await this.prisma.shipmentPiece.findMany({ where: { shipmentId }, orderBy: { sequenceNo: 'asc' }, select: { id: true } });
    await this.prisma.$transaction([
      // LR goes on forwardingAwb only — bdWaybill is BlueDart's (it made Delhivery shipments look like BlueDart).
      this.prisma.shipment.update({ where: { id: shipmentId }, data: { forwardingAwb: lrn, bdStatus: 'Manifested (Delhivery)', bdHandedAt: new Date() } }),
      ...pieces.slice(0, waybills.length).map((pc, i) => this.prisma.shipmentPiece.update({ where: { id: pc.id }, data: { carrierChildId: waybills[i] } })),
    ]);
    return { lrn, status };
  }

  /**
   * Delhivery B2B only collects from registered warehouses. Register this shipment's pickup (shipper)
   * address under a stable name — LGM + account code + pincode + short address hash — once, cache it in
   * delhivery_warehouses, and reuse it for every later hand-off from the same address.
   */
  async ensureWarehouse(s: any): Promise<string> {
    const c = s.client ?? {};
    const address = String([s.shipperAddress1, s.shipperAddress2].filter(Boolean).join(', ') || c.addressLine || '').trim();
    const pin = String(s.shipperPincode || c.pincode || '').trim();
    // First candidate with a real 10-digit mobile (shipperContact is often a person's name).
    const phone = [s.shipperMobile, s.shipperPhone, s.shipperContact, c.contactPhone, c.tel1]
      .map((v: any) => String(v ?? '').replace(/\D/g, '').slice(-10)).find((v: string) => v.length === 10) ?? '';
    const missing = [!address && 'pickup address', !/^\d{6}$/.test(pin) && 'pickup pincode', phone.length !== 10 && 'pickup 10-digit mobile'].filter(Boolean);
    if (missing.length) throw new BadRequestException(`Delhivery needs the ${missing.join(', ')} to register the pickup point — fix it on the AWB (Edit AWB).`);
    const norm = address.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let h = 0; for (const ch of norm) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    // Warehouses belong to ONE Delhivery account — the default (DLY) keeps "LGM…", others get their code in the name.
    const pre = this.acct().code === 'DLY' ? 'LGM' : `LGM${this.acct().code}`;
    const name = `${pre}${String(c.accountCode || 'X').toUpperCase().replace(/[^A-Z0-9]/g, '')}${pin}${h.toString(36).toUpperCase().slice(-4)}`;
    if (await this.prisma.delWarehouse.findUnique({ where: { name } })) return name;

    const pc = await this.prisma.pincode.findUnique({ where: { pincode: pin }, select: { city: true, state: true } }).catch(() => null);
    const city = (await cityName(this.prisma, pin, s.shipperCity, c.city, pc?.city)).trim();
    const state = String(s.shipperState || c.state || pc?.state || '').trim();
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const hours = (start: string, close: string) => Object.fromEntries(days.map((d) => [d, { start_time: start, close_time: close }]));
    try {
      await this.req('/client-warehouse/create/', {
        method: 'POST',
        body: JSON.stringify({
          name, pin_code: pin, city: city || 'NA', state: state || 'NA', country: 'India',
          address_details: { address: address.slice(0, 250), contact_person: String(s.shipperName || c.contactName || c.legalName || 'Shipper').slice(0, 80), phone_number: phone },
          business_hours: hours('09:00', '19:00'), pick_up_hours: hours('10:00', '18:00'), business_days: days, pick_up_days: days,
          ret_address: { pin, address: address.slice(0, 250) },
        }),
      });
    } catch (e: any) {
      // Already registered at Delhivery (e.g. cache lost) — fine, use it.
      if (!/already|exist|duplicate/i.test(String(e?.message))) throw new BadRequestException(`Delhivery could not register the pickup point: ${String(e?.message || e)}`);
    }
    await this.prisma.delWarehouse.upsert({ where: { name }, update: {}, create: { name, clientId: s.clientId ?? null, pincode: pin, address } });
    return name;
  }

  /** The shipment's invoice copy from its attachments — prefer one that looks like an invoice, else the latest. */
  private async invoiceCopy(shipmentId: bigint): Promise<{ data: Buffer; mimeType: string; filename: string } | null> {
    const docs = await this.prisma.document.findMany({ where: { entityType: 'shipment', entityId: shipmentId, status: { not: 'archived' } }, orderBy: { createdAt: 'desc' } });
    const d = docs.find((x) => /invoice/i.test(x.docType) || /inv/i.test(x.label || '')) ?? docs[0];
    if (!d) return null;
    const up = await this.prisma.upload.findUnique({ where: { id: d.uploadId } });
    if (!up) return null;
    const ext = up.mimeType === 'application/pdf' ? 'pdf' : (up.mimeType.split('/')[1] || 'jpg');
    return { data: Buffer.from(up.data), mimeType: up.mimeType, filename: (d.label && /\.[a-z0-9]+$/i.test(d.label)) ? d.label : `invoice.${ext}` };
  }

  /** Our billing identity for Delhivery: COMPANY master DELHIVERY_BILLING_COMPANY (code), else the first
   *  Logimart entity, else the default. Address/city/pin parsed from the entity's address lines. */
  private async billingEntity() {
    const all = await this.prisma.masterEntry.findMany({ where: { type: 'COMPANY', active: true } }).catch(() => [] as any[]);
    const want = (process.env.DELHIVERY_BILLING_COMPANY ?? '').trim().toUpperCase();
    const e: any = (want && all.find((x: any) => x.code.toUpperCase() === want)) || all.find((x: any) => /LOGIMART/i.test((x.attrs as any)?.legalName || '')) || all.find((x: any) => (x.attrs as any)?.isDefault) || all[0];
    const a: any = e?.attrs ?? {};
    const lines: string[] = Array.isArray(a.addressLines) ? a.addressLines : [];
    const joined = lines.join(', ');
    const pin = (joined.match(/\d{6}/) || [''])[0];
    const pan = String(a.pan || (a.gstin ? String(a.gstin).slice(2, 12) : '')).toUpperCase();
    return {
      legalName: String(a.legalName || e?.name || 'LOGIMART TECHNOLOGIES PRIVATE LIMITED'),
      address: joined || 'NA', city: String(a.city || (joined.match(/,\s*([A-Za-z ]+)\s*-?\s*\d{6}/)?.[1] ?? '')).trim() || 'NA',
      state: String(a.state || stateFromGst(a.gstin) || 'NA'), pin, phone: String(a.phones || '').replace(/\D/g, '').slice(-10),
      gstin: String(a.gstin || '').toUpperCase(), pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : '',
    };
  }

  manifestStatus(jobId: string) {
    return this.req(`/manifest?job_id=${encodeURIComponent(jobId)}`, { method: 'GET' });
  }

  /** Cancel an LR (before pickup). */
  async cancelLr(awb: string) {
    const v = await this.prisma.shipment.findUnique({ where: { awb }, select: { vendor: true } });
    return this.withAccount(v?.vendor, () => this.cancelLrAs(awb));
  }

  private async cancelLrAs(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, forwardingAwb: true } });
    const lrn = s?.forwardingAwb;
    if (!lrn) throw new BadRequestException(`No Delhivery LR on ${awb} to cancel.`);
    const resp = await this.req(`/lrn/cancel/${encodeURIComponent(lrn)}`, { method: 'DELETE' });
    if (s?.id) await this.prisma.shipment.update({ where: { id: s.id }, data: { bdStatus: 'CANCELLED (Delhivery)' } });
    return { awb, lrn, response: resp };
  }

  // ---- tracking / documents / pickup ----

  track(lrn: string) {
    return this.req(`/lrn/track?lrnum=${encodeURIComponent(lrn)}`, { method: 'GET' });
  }

  /** Pull the latest Delhivery LR status onto the Logimart shipment. */
  async syncTracking(awb: string) {
    const v = await this.prisma.shipment.findUnique({ where: { awb }, select: { vendor: true } });
    return this.withAccount(v?.vendor, () => this.syncTrackingAs(awb));
  }

  private async syncTrackingAs(awb: string) {
    let s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, forwardingAwb: true, statusCode: true, bdStatus: true } });
    // Hand-off still waiting on Delhivery's async manifest job → resolve the LR first.
    const job = /^Delhivery job (\S+)/.exec(String(s?.bdStatus || ''))?.[1];
    if (s && !s.forwardingAwb && job) {
      const r = await this.applyManifestJob(s.id, job);
      if (!r.lrn) return { awb, lrn: null, status: `Manifest ${r.status ?? 'pending'}`, location: null, tracking: null };
      s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, forwardingAwb: true, statusCode: true, bdStatus: true } });
    }
    const lrn = s?.forwardingAwb;
    if (!lrn) throw new BadRequestException(`No Delhivery LR on ${awb} to track.`);
    const r: any = await this.track(lrn);
    // Tolerate a few response shapes for the latest scan.
    const scan = r?.data?.[0] ?? r?.data ?? r?.lr_status ?? r;
    const status = scan?.status ?? scan?.current_status ?? scan?.Status ?? null;
    // Write the carrier status through to our milestone (same mapper as BlueDart) so lists/dashboards are right.
    const derived = status ? deriveStatusFromBd(s?.statusCode, String(status)) : null;
    if (status) await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus: String(status), ...(derived ? { statusCode: derived.statusCode, status: derived.status, statusAt: new Date() } : {}) } });
    return { awb, lrn, status, location: scan?.location ?? scan?.current_location ?? null, tracking: r };
  }

  /** Signed URL(s) for the shipping label of an LR. */
  shippingLabel(lrn: string) {
    return this.req(`/label/get_urls/std/${encodeURIComponent(lrn)}`, { method: 'GET' });
  }

  /** Shipping label for a Logimart AWB (resolves its Delhivery LR). */
  async labelForAwb(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true, vendor: true } });
    if (s?.forwardingAwb) return this.withAccount(s.vendor, () => this.shippingLabel(s.forwardingAwb!));
    if (!s?.forwardingAwb) throw new BadRequestException(`No Delhivery LR on ${awb} — hand it off first.`);
    return this.shippingLabel(s.forwardingAwb);
  }

  /** Schedule a first-mile pickup at a registered warehouse. */
  createPickup(dto: { warehouse?: string; date: string; startTime?: string; packages?: number }) {
    return this.req('/pickup_requests', {
      method: 'POST',
      body: JSON.stringify({
        client_warehouse: (dto.warehouse || DELHIVERY.pickupName || '').trim(),
        pickup_date: dto.date,
        start_time: dto.startTime || '10:00:00',
        expected_package_count: dto.packages ?? 1,
      }),
    });
  }

  cancelPickup(purId: string) {
    return this.req(`/pickup_requests/${encodeURIComponent(purId)}`, { method: 'DELETE' });
  }
}
