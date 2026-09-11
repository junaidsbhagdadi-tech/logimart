import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DELHIVERY, delConfigured } from './delhivery.config';

/**
 * Delhivery B2B / LTL API. Auth: POST /ums/login {username,password} → Bearer token (cached in
 * IntegrationToken, re-login on 401). Consignment = LR (Lorry Receipt); creating one is the async
 * /manifest job. Endpoints wired: serviceability, TAT, freight estimate, manifest (create LR) +
 * status, LR track, shipping label, create/cancel pickup, LR cancel.
 */
@Injectable()
export class DelhiveryService {
  constructor(private readonly prisma: PrismaService) {}

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
      env: /-dev\./.test(DELHIVERY.baseUrl) ? 'STAGING' : 'PRODUCTION',
    };
  }

  /** UMS login → Bearer token, cached in Postgres (re-login early or on force/401). */
  private async token(force = false): Promise<string> {
    this.ensure();
    if (!force) {
      const cached = await this.prisma.integrationToken.findUnique({ where: { provider: 'DELHIVERY' } });
      if (cached && cached.expiresAt.getTime() > Date.now() + 60_000) return cached.token;
    }
    const res = await fetch(`${DELHIVERY.baseUrl}/ums/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: DELHIVERY.username, password: DELHIVERY.password }),
    });
    const text = await res.text();
    if (!res.ok) throw new BadRequestException(`Delhivery login failed (${res.status}): ${text.slice(0, 200)}`);
    let token = '';
    try { const j = JSON.parse(text); token = j.token || j.jwt || j.access_token || j.data?.token || j.data?.jwt || j.data?.access_token || ''; } catch { /* non-JSON */ }
    if (!token) throw new BadRequestException('Delhivery login returned no token.');
    const expiresAt = new Date(Date.now() + 6 * 3600 * 1000); // assume ~6h; a 401 forces re-login anyway
    await this.prisma.integrationToken.upsert({
      where: { provider: 'DELHIVERY' },
      update: { token, expiresAt },
      create: { provider: 'DELHIVERY', token, expiresAt },
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
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: true } }) as any;
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    const pickup = (pickupName || DELHIVERY.pickupName || '').trim();
    if (!pickup) throw new BadRequestException('No pickup warehouse — set DELHIVERY_PICKUP_NAME or pass one.');

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
    fd.append('dropoff_location', JSON.stringify({
      consignee_name: s.consigneeName ?? '', address: s.consigneeAddress ?? '', city: s.consigneeCity ?? '',
      state: s.consigneeState ?? '', zip: s.destPincode ?? '', phone: s.consigneePhone ?? '', email: '',
    }));
    fd.append('rov_insurance', invAmt > 50000 ? 'True' : 'False');
    fd.append('invoices', JSON.stringify([{ ewaybill: s.ewbNo ?? '', inv_num: s.referenceNo || String(s.awb), inv_amt: invAmt, inv_qr_code: '' }]));
    fd.append('shipment_details', JSON.stringify([{ order_id: String(s.awb), box_count: Number(s.pieceCount ?? 1), description: s.goodsDesc ?? 'Goods', weight: weightG, waybills: [], master: false }]));
    if (dims.length) fd.append('dimensions', JSON.stringify(dims));
    fd.append('fm_pickup', 'False'); // schedule the pickup separately via createPickup
    fd.append('freight_mode', toPay ? 'fod' : 'fop'); // fod = freight on delivery (To-Pay), fop = freight on payer
    fd.append('billing_address', JSON.stringify({
      name: s.shipperName ?? s.client?.legalName ?? '', company: s.client?.legalName ?? '', consignor: s.shipperName ?? s.client?.legalName ?? '',
      address: s.shipperAddress1 ?? s.client?.addressLine ?? '', city: s.shipperCity ?? s.client?.city ?? '', state: s.shipperState ?? s.client?.state ?? '',
      pin: s.shipperPincode ?? s.client?.pincode ?? '', phone: s.shipperContact ?? s.client?.contactPhone ?? '',
      gst_number: s.consignorGstin ?? s.client?.gstin ?? '', pan_number: s.client?.pan ?? '',
    }));

    const resp = await this.req('/manifest', { method: 'POST' }, fd);
    const jobId = resp?.job_id ?? resp?.jobId ?? resp?.data?.job_id ?? null;
    // The manifest is async — poll a few times for the LR before giving up (caller can poll later too).
    let lrn: string | null = resp?.lrn ?? resp?.lr_number ?? null;
    if (!lrn && jobId) {
      for (let i = 0; i < 6 && !lrn; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await this.manifestStatus(String(jobId)).catch(() => null);
        lrn = st?.lrn ?? st?.lr_number ?? st?.data?.lrn ?? (st?.data?.[0]?.lrn) ?? null;
      }
    }
    if (lrn) {
      await this.prisma.shipment.update({ where: { id: s.id }, data: { forwardingAwb: lrn, vendor: s.vendor ?? 'DELHIVERY', bdWaybill: lrn, bdHandedAt: new Date() } });
    }
    return { awb, lrn, jobId, response: resp };
  }

  manifestStatus(jobId: string) {
    return this.req(`/manifest?job_id=${encodeURIComponent(jobId)}`, { method: 'GET' });
  }

  /** Cancel an LR (before pickup). */
  async cancelLr(awb: string) {
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
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true } });
    const lrn = s?.forwardingAwb;
    if (!lrn) throw new BadRequestException(`No Delhivery LR on ${awb} to track.`);
    const r: any = await this.track(lrn);
    // Tolerate a few response shapes for the latest scan.
    const scan = r?.data?.[0] ?? r?.data ?? r?.lr_status ?? r;
    const status = scan?.status ?? scan?.current_status ?? scan?.Status ?? null;
    if (status) await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus: String(status) } });
    return { awb, lrn, status, location: scan?.location ?? scan?.current_location ?? null, tracking: r };
  }

  /** Signed URL(s) for the shipping label of an LR. */
  shippingLabel(lrn: string) {
    return this.req(`/label/get_urls/std/${encodeURIComponent(lrn)}`, { method: 'GET' });
  }

  /** Shipping label for a Logimart AWB (resolves its Delhivery LR). */
  async labelForAwb(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true } });
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
