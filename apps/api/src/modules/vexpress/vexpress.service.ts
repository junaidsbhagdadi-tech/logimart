import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveStatusFromBd } from '../bluedart/bd-status';

/**
 * V Express (Vijayant "ShipX" platform) — Velocia account 223882, from their Postman collection.
 *   POST /integration/consignments/create.json   create consignment (LR)      header X-ShipX-API-Key
 *   POST /integration/consignments/list.json     track / list by LR number
 *   POST /integration/pods/list.json             POD
 * Env: VXP_API_KEY (create/track) · VXP_POD_KEY (POD; defaults to VXP_API_KEY) · VXP_SHIPPER_CODE (223882)
 *      VXP_SERVICE (default "SURF XPRS") · VXP_BASE_URL (default https://vxpress.vijayant.in)
 * The pickup goes as a plain address (consignor_* fields) — no registered facility needed.
 * There is no cancel API in the collection: cancellations are done on the V Express portal.
 */
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const V = {
  base: env('VXP_BASE_URL', 'https://vxpress.vijayant.in').replace(/\/$/, ''),
  key: env('VXP_API_KEY'),
  podKey: env('VXP_POD_KEY') || env('VXP_API_KEY'),
  shipper: env('VXP_SHIPPER_CODE', '223882'),
  service: env('VXP_SERVICE', 'SURF XPRS'),
};
export const vxConfigured = () => !!V.key;
export const isVExpressVendor = (v?: string | null) => /^VXP$|^VX$|V\s*EXPRESS/i.test(String(v ?? '').trim());

const cut = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const mobile = (...vals: any[]) => vals.map((v) => String(v ?? '').replace(/\D/g, '').slice(-10)).find((v) => v.length === 10) ?? '';
const inches = (cm: any) => (Number(cm) > 0 ? (Number(cm) / 2.54).toFixed(1) : '');

@Injectable()
export class VExpressService implements OnModuleInit {
  private readonly log = new Logger('VExpress');
  private syncing = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const mins = Number(process.env.VXP_SYNC_INTERVAL_MIN ?? 30);
    if (!vxConfigured() || !(mins > 0)) return;
    const t = setInterval(() => this.autoSync().catch((e) => this.log.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (t as any).unref?.();
  }

  status() {
    return { configured: vxConfigured(), apiKey: V.key ? 'set' : 'missing', podKey: V.podKey ? 'set' : 'missing', shipperCode: V.shipper, service: V.service, baseUrl: V.base };
  }

  private async post(path: string, body: unknown, key = V.key) {
    if (!key) throw new BadRequestException('V Express not configured — set VXP_API_KEY on the server.');
    const res = await fetch(`${V.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ShipX-API-Key': key }, body: JSON.stringify(body) });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok || data?.exception) {
      const m = data?.exception?.message || data?.errors || data?.error || text.slice(0, 300);
      throw new BadRequestException(`V Express ${res.status}: ${typeof m === 'string' ? m : JSON.stringify(m).slice(0, 300)}`);
    }
    return data;
  }

  /** Book the shipment with V Express → their LR number becomes the forwarding AWB. */
  async handoff(awb: string) {
    const s: any = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: { orderBy: { sequenceNo: 'asc' } } } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    if (s.forwardingAwb) throw new BadRequestException(`${awb} already has a carrier LR (${s.forwardingAwb}).`);
    const c = s.client ?? {};
    const shipPhone = mobile(s.shipperMobile, s.shipperContact, c.contactPhone, c.tel1);
    const consPhone = mobile(s.consigneePhone);
    const pin = String(s.shipperPincode || c.pincode || '');
    const missing = [
      !(s.shipperAddress1 || c.addressLine) && 'pickup address', !/^\d{6}$/.test(pin) && 'pickup pincode', !shipPhone && 'pickup 10-digit mobile',
      !s.consigneeName && 'consignee name', !s.consigneeAddress && 'consignee address', !/^\d{6}$/.test(String(s.destPincode || '')) && 'consignee pincode',
    ].filter(Boolean);
    if (missing.length) throw new BadRequestException(`V Express needs: ${missing.join(', ')} — fix them on the AWB (Edit AWB).`);
    const pc = await this.prisma.pincode.findMany({ where: { pincode: { in: [pin, String(s.destPincode)] } }, select: { pincode: true, city: true, state: true } }).catch(() => [] as any[]);
    const P = (p: string) => pc.find((x: any) => x.pincode === p);
    const value = Number(s.declaredValue ?? s.shipmentValue ?? 0);
    const kg = Number(s.totalDeadKg || s.chargeWeight || 0.5);
    const first = s.pieces[0] ?? {};
    const toPay = String(s.paymentTerm).toUpperCase() === 'TO_PAY';
    const created = new Date(new Date(s.createdAt).getTime() + 330 * 60000).toISOString().slice(0, 10);

    const body = {
      consignment: {
        consolidate: 'No', shipper_company_code: V.shipper, consignment_number: '', is_draft: 'No', from_challan_id: '',
        consignor_company_id: '', consignor_company_name: cut(s.shipperName || c.legalName, 100), consignor_company_code: V.shipper,
        consignor_facility_name: '', consignor_facility_code: '',
        consignor_address_line1: cut(s.shipperAddress1 || c.addressLine, 150), consignor_address_line2: cut(s.shipperAddress2, 150),
        consignor_city: cut(s.shipperCity || c.city || P(pin)?.city, 50), consignor_state: cut(s.shipperState || c.state || P(pin)?.state, 50),
        consignor_pin: pin, consignor_contact_name: cut(s.shipperContact || c.contactName || s.shipperName, 60), consignor_phone: shipPhone,
        consignee_company_id: '', consignee_company_name: cut(s.consigneeName, 100), consignee_company_code: '', consignee_facility_name: '', consignee_facility_code: '',
        consignee_address_line1: cut(s.consigneeAddress, 150), consignee_address_line2: '',
        consignee_city: cut(s.consigneeCity || P(String(s.destPincode))?.city, 50), consignee_state: cut(s.consigneeState || P(String(s.destPincode))?.state, 50),
        consignee_pin: String(s.destPincode), consignee_contact_name: cut(s.consigneeName, 60), consignee_phone: consPhone,
        reference_number_1: String(s.awb), reference_number_2: cut(s.referenceNo || s.custInvoiceNo, 50),
        service_option: V.service, truck_category: '', service_provider_company_code: 'VX', vehicle_number: '', driver_name: '', driver_mobile_number: '',
        volume: '', volume_measure: '', ready_for_pickup_at: '',
        payment_mode: toPay ? 'To Pay' : 'To Bill',
        slot_date: '', slot_name: '', slot_company_code: '',
        weight: kg.toFixed(2), billable_weight: '', weight_measure: 'Kgs',
        consignment_contents: {
          consignment_content: {
            reference_number: '', delivery_number: null, product_id: '', product_name: 'OTHERS', product_display_name: cut(s.goodsDesc || 'General goods', 60),
            units: String(s.pieceCount || s.pieces.length || 1), unit_type: 'Cartons', weight: kg.toFixed(2), billable_weight: '', weight_measure: 'Kgs',
            length: inches(first.lengthCm), width: inches(first.widthCm), height: inches(first.heightCm), uom: 'inches',
          },
        },
        consignment_invoices: {
          consignment_invoice: {
            invoice_number: cut(s.custInvoiceNo || s.referenceNo || s.awb, 50), delivery_number: null, invoice_value: value ? value.toFixed(2) : '', invoice_date: created,
            cod_amount: '', weight: '', billable_weight: '', weight_measure: '', pickable_units: '',
            eway_bill_number: s.ewbNo ? String(s.ewbNo) : '', eway_bill_expiry_date: s.ewbValidUpto ? new Date(s.ewbValidUpto).toISOString().slice(0, 10) : '',
          },
        },
        service_provider_id: '', service_provider_name: '', service_provider_code: '',
        consignment_type: toPay ? 'OUTBOUND-TOPAY' : 'OUTBOUND-TBB',
      },
    };
    const r = await this.post('/integration/consignments/create.json', body);
    const lr = String(r?.consignment?.number ?? r?.lr?.number ?? r?.number ?? r?.consignment_number ?? '').trim();
    if (!lr) throw new BadRequestException(`V Express did not return an LR number: ${JSON.stringify(r).slice(0, 300)}`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { forwardingAwb: lr, vendor: s.vendor || 'VXP', bdStatus: 'Booked (V Express)', bdHandedAt: new Date() } });
    return { awb, lr, response: r };
  }

  /** One LR's record from V Express (null if not found). */
  async lr(number: string) {
    const r = await this.post('/integration/consignments/list.json', { lr: { 'service-provider-company-code': 'VX', number, 'include-canceled-lrs': 'Yes' } });
    return (r?.lrs ?? [])[0]?.lr ?? null;
  }

  async pod(number: string) {
    return this.post('/integration/pods/list.json', { lr: { service_provider_code: 'VX', number } }, V.podKey);
  }

  /** Pull the V Express status onto the shipment (and their POD link once delivered). */
  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true, statusCode: true, podUrl: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No V Express LR on ${awb} to track.`);
    const d = await this.lr(s.forwardingAwb);
    if (!d) throw new BadRequestException(`V Express has no LR ${s.forwardingAwb} on this account.`);
    const status = String(d.readable_status || '').trim();
    const text = /cancel/i.test(status) ? null : `${status} ${d.tracking_status || ''}`;
    const label = `${d.tracking_status || status || 'Booked'}${d.reason_for_delay ? ` (${d.reason_for_delay})` : ''} (V Express)`;
    const derived = text ? deriveStatusFromBd(s.statusCode, text) : null;
    // Delivered → bring their POD link across, so our Delivered milestone has proof attached.
    let podUrl: string | undefined;
    if (derived?.statusCode === 'DLD' && !s.podUrl) {
      const p = await this.pod(s.forwardingAwb).catch(() => null);
      podUrl = (p?.lrs ?? [])[0]?.pod_img_url ?? undefined; // EPOD photo on their S3
    }
    await this.prisma.shipment.updateMany({
      where: { awb },
      data: { bdStatus: /cancel/i.test(status) ? 'CANCELLED (V Express)' : label, ...(derived ? { statusCode: derived.statusCode, status: derived.status, statusAt: new Date() } : {}), ...(podUrl ? { podUrl } : {}) },
    });
    return { awb, lr: s.forwardingAwb, status: label, statusCode: derived?.statusCode ?? s.statusCode, charge: d.total_charge ?? null, billedKg: d.billed_weight_in_kgs ?? null, tracking: d };
  }

  async autoSync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 864e5) }, forwardingAwb: { not: null },
          AND: [{ OR: [{ vendor: { in: ['VXP', 'VX'] } }, { vendor: { contains: 'V EXPRESS', mode: 'insensitive' } }] }, { OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] }],
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
