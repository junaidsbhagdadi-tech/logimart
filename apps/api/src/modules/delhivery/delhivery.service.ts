import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DELHIVERY, delConfigured } from './delhivery.config';

/**
 * Delhivery B2C API. Auth is a static token (Authorization: Token <token>) — no JWT exchange.
 * Endpoints: pincode serviceability, create shipment (manifest → returns waybill), tracking.
 */
@Injectable()
export class DelhiveryService {
  constructor(private readonly prisma: PrismaService) {}

  private ensure() {
    if (!delConfigured()) {
      throw new BadRequestException('Delhivery not configured — set DELHIVERY_API_TOKEN, DELHIVERY_BASE_URL, DELHIVERY_PICKUP_NAME.');
    }
  }

  status() {
    return {
      configured: delConfigured(),
      token: DELHIVERY.token ? 'set' : 'missing',
      tokenLen: DELHIVERY.token.length, // should be 40 for a B2C token — flags stray whitespace
      tokenTail: DELHIVERY.token ? '…' + DELHIVERY.token.slice(-4) : '', // confirm the right token loaded
      baseUrl: DELHIVERY.baseUrl || 'missing',
      pickupName: DELHIVERY.pickupName || 'missing',
    };
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Token ${DELHIVERY.token}`, Accept: 'application/json', ...extra };
  }

  /** Pincode serviceability + pre-paid/COD flags. GET /c/api/pin-codes/json/?token=<t>&filter_codes=<pin>
   *  (this legacy endpoint authenticates via the token query param, not the Authorization header). */
  async serviceability(pincode: string) {
    this.ensure();
    const url = `${DELHIVERY.baseUrl}/c/api/pin-codes/json/?token=${encodeURIComponent(DELHIVERY.token)}&filter_codes=${encodeURIComponent(pincode)}`;
    const res = await fetch(url, { headers: this.headers() });
    const text = await res.text();
    if (!res.ok) throw new BadRequestException(`Delhivery serviceability ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  /**
   * Hand a Logimart shipment to Delhivery (Waybill Creation / Manifestation).
   * POST /api/cmu/create.json  body: format=json&data=<json>  (form-encoded).
   * A blank waybill lets Delhivery auto-assign one; the response returns it.
   */
  async createShipment(awb: string) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);

    const payment = String((s as any).paymentTerm).toUpperCase() === 'TO_PAY' || (s as any).isDod ? 'COD' : 'Prepaid';
    const codAmount = payment === 'COD'
      ? Number((s as any).dodAmount || (s as any).freightToCollect || (s as any).shipmentValue || 0)
      : 0;
    const totalKg = Number((s as any).chargeWeight ?? (s as any).totalDeadKg ?? 0.5) || 0.5;
    const first = (s.pieces ?? [])[0] as any;

    const shipment = {
      name: (s as any).consigneeName ?? '',
      add: (s as any).consigneeAddress ?? '',
      pin: (s as any).destPincode ?? '',
      city: (s as any).consigneeCity ?? '',
      state: (s as any).consigneeState ?? '',
      country: 'India',
      phone: (s as any).consigneePhone ?? '',
      order: String(s.awb),                 // our unique reference (client order id)
      payment_mode: payment,                 // Prepaid | COD | Pickup
      cod_amount: codAmount,
      total_amount: Number((s as any).shipmentValue ?? (s as any).declaredValue ?? 0),
      quantity: String(s.pieceCount ?? 1),
      weight: Math.round(totalKg * 1000),    // grams
      shipment_length: first ? Number(first.lengthCm || 0) : 0,
      shipment_width: first ? Number(first.widthCm || 0) : 0,
      shipment_height: first ? Number(first.heightCm || 0) : 0,
      waybill: (s as any).forwardingAwb ?? '', // blank = Delhivery assigns
      products_desc: (s as any).goodsDesc ?? 'Goods',
      // seller / return = our (shipper) details
      seller_name: (s as any).shipperName ?? s.client?.legalName ?? '',
      seller_add: (s as any).shipperAddress1 ?? s.client?.addressLine ?? '',
      seller_gst_tin: (s as any).consignorGstin ?? s.client?.gstin ?? '',
      return_name: (s as any).shipperName ?? s.client?.legalName ?? '',
      return_add: (s as any).shipperAddress1 ?? s.client?.addressLine ?? '',
      return_pin: (s as any).shipperPincode ?? s.client?.pincode ?? '',
      return_phone: (s as any).shipperContact ?? s.client?.contactPhone ?? '',
    };

    const data = { shipments: [shipment], pickup_location: { name: DELHIVERY.pickupName } };
    const body = `format=json&data=${encodeURIComponent(JSON.stringify(data))}`;
    const res = await fetch(`${DELHIVERY.baseUrl}/api/cmu/create.json`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body,
    });
    const text = await res.text();
    let resp: any; try { resp = JSON.parse(text); } catch { resp = { raw: text }; }
    if (!res.ok) throw new BadRequestException(`Delhivery ${res.status}: ${text.slice(0, 300)}`);

    // Response: { success, packages: [{ waybill, status, remarks, refnum, ... }] }
    const pkg = (resp?.packages ?? [])[0];
    const ok = resp?.success === true || pkg?.status === 'Success';
    if (!ok) {
      const rmk = pkg?.remarks?.join?.('; ') || resp?.rmk || pkg?.status || JSON.stringify(resp).slice(0, 300);
      throw new BadRequestException(`Delhivery rejected the shipment: ${rmk}`);
    }
    const waybill = pkg?.waybill || null;
    if (waybill) {
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: { forwardingAwb: waybill, vendor: (s as any).vendor ?? 'DELHIVERY', bdHandedAt: new Date() },
      });
    }
    return { awb, waybill, response: resp };
  }

  /** Cancel a Delhivery shipment (before pickup). POST /api/p/edit {waybill, cancellation:"true"}. */
  async cancel(awb: string) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, forwardingAwb: true } });
    const waybill = s?.forwardingAwb;
    if (!waybill) throw new BadRequestException(`No Delhivery waybill on ${awb} to cancel.`);
    const res = await fetch(`${DELHIVERY.baseUrl}/api/p/edit`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ waybill, cancellation: 'true' }),
    });
    const text = await res.text();
    let resp: any; try { resp = JSON.parse(text); } catch { resp = { raw: text }; }
    if (!res.ok) throw new BadRequestException(`Delhivery cancel ${res.status}: ${text.slice(0, 300)}`);
    const ok = resp?.status === true || /cancel/i.test(String(resp?.remark ?? ''));
    if (!ok) throw new BadRequestException(`Delhivery did not cancel: ${resp?.remark ?? JSON.stringify(resp).slice(0, 200)}`);
    if (s?.id) await this.prisma.shipment.update({ where: { id: s.id }, data: { bdStatus: 'CANCELLED (Delhivery)' } });
    return { awb, waybill, response: resp };
  }

  /** Track a Delhivery waybill. GET /api/v1/packages/json/?token=<t>&waybill=<wb> (token via query too). */
  async track(waybill: string) {
    this.ensure();
    const url = `${DELHIVERY.baseUrl}/api/v1/packages/json/?token=${encodeURIComponent(DELHIVERY.token)}&waybill=${encodeURIComponent(waybill)}`;
    const res = await fetch(url, { headers: this.headers() });
    const text = await res.text();
    if (!res.ok) throw new BadRequestException(`Delhivery tracking ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  /** Pull the latest Delhivery status onto the Logimart shipment. */
  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true } });
    const wb = s?.forwardingAwb || awb;
    const r = await this.track(wb);
    const scan = r?.ShipmentData?.[0]?.Shipment?.Status;
    const status = scan?.Status ?? null;
    if (status) await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus: status } });
    return { awb, waybill: wb, status, statusAt: scan?.StatusDateTime ?? null, location: scan?.StatusLocation ?? null, tracking: r };
  }
}
