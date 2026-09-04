import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BLUEDART, bdConfigured } from './bluedart.config';

@Injectable()
export class BluedartService {
  constructor(private readonly prisma: PrismaService) {}

  private ensure() {
    if (!bdConfigured()) {
      throw new BadRequestException('BlueDart not configured — set the BLUEDART_* env vars (base URL, auth URL, client id/secret, loginid, lickey).');
    }
  }

  status() {
    return {
      configured: bdConfigured(),
      baseUrl: BLUEDART.baseUrl ? 'set' : 'missing',
      authUrl: BLUEDART.authUrl ? 'set' : 'missing',
      clientId: BLUEDART.clientId ? 'set' : 'missing',
      loginId: BLUEDART.loginId ? 'set' : 'missing',
      licKey: BLUEDART.licKey ? 'set' : 'missing',
    };
  }

  /** Valid JWT — cached in Postgres (24h), refreshed a little early or on force. */
  async getToken(force = false): Promise<string> {
    this.ensure();
    if (!force) {
      const cached = await this.prisma.integrationToken.findUnique({ where: { provider: 'BLUEDART' } });
      if (cached && cached.expiresAt.getTime() > Date.now() + 60_000) return cached.token;
    }
    // Blue Dart Authentication API → JWT. Exact header names finalized against the doc/UAT.
    const res = await fetch(BLUEDART.authUrl, {
      method: 'GET',
      headers: { ClientID: BLUEDART.clientId, clientSecret: BLUEDART.clientSecret, accept: 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) throw new BadRequestException(`BlueDart auth failed (${res.status}): ${text.slice(0, 200)}`);
    let token = '';
    try { const j = JSON.parse(text); token = j.JWTToken || j.jwtToken || j.token || ''; } catch { token = text.trim(); }
    if (!token) throw new BadRequestException('BlueDart auth returned no token.');
    const expiresAt = new Date(Date.now() + 23.5 * 3600 * 1000);
    await this.prisma.integrationToken.upsert({
      where: { provider: 'BLUEDART' },
      update: { token, expiresAt },
      create: { provider: 'BLUEDART', token, expiresAt },
    });
    return token;
  }

  /** Authenticated call — attaches the JWT header. Parses JSON, else returns raw (some endpoints are XML). */
  private async authed(path: string, init: RequestInit = {}) {
    const token = await this.getToken();
    const url = path.startsWith('http') ? path : `${BLUEDART.baseUrl}${path}`;
    const res = await fetch(url, { ...init, headers: { JWTToken: token, 'content-type': 'application/json', ...(init.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new BadRequestException(`BlueDart ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  /** Tracking — shipment details/status for a BlueDart waybill (returns XML in `raw`). */
  async track(awb: string) {
    this.ensure();
    // TSD tracking URL: handler=tnt, action=custawbquery, awb=awb, numbers=<waybill>, format=xml, scan=1 (all scans).
    const q = `/tracking/v1?handler=tnt&action=custawbquery&loginid=${encodeURIComponent(BLUEDART.loginId)}&awb=awb&numbers=${encodeURIComponent(awb)}&format=xml&lickey=${encodeURIComponent(BLUEDART.licKey)}&verno=1&scan=1`;
    return this.authed(q, { method: 'GET' });
  }

  /** Serviceability — GetServicesforPincode. Request shape finalized on UAT. */
  async serviceability(pincode: string) {
    this.ensure();
    return this.authed('/finder/v1/GetServicesforPincode', {
      method: 'POST',
      body: JSON.stringify({ pinCode: pincode, profile: { LoginID: BLUEDART.loginId, LicenceKey: BLUEDART.licKey } }),
    });
  }

  /**
   * Hand off a Logimart shipment to BlueDart (GenerateWayBill). The full request has
   * ~40 fields; mapWaybill() is the Logimart→BlueDart mapping, finalized field-by-field
   * against the TSD during UAT. On success we store the BlueDart waybill on the shipment.
   */
  async generateWaybill(awb: string) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    const payload = this.mapWaybill(s);
    const resp = await this.authed('/waybill/v1/GenerateWayBill', { method: 'POST', body: JSON.stringify(payload) });
    // TSD WayBillGenerationResponse: AWBNo, IsError, Status[]{StatusCode,StatusInformation}, TokenNumber…
    if (resp?.IsError === true || resp?.isError === true) {
      const msg = (resp?.Status ?? resp?.status ?? []).map((x: any) => x?.StatusInformation ?? x?.statusInformation).filter(Boolean).join('; ');
      throw new BadRequestException(`BlueDart rejected the waybill: ${msg || JSON.stringify(resp).slice(0, 300)}`);
    }
    const bdWaybill = resp?.AWBNo || resp?.awbNo || resp?.GenerateWayBillResult?.AWBNo || null;
    if (bdWaybill) {
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: { bdWaybill, forwardingAwb: (s as any).forwardingAwb ?? bdWaybill, vendor: (s as any).vendor ?? 'BLUEDART', bdHandedAt: new Date() },
      });
    }
    return { awb, bdWaybill, token: resp?.TokenNumber ?? null, labelBase64: resp?.AWBPrintContent ?? null, response: resp };
  }

  /** Logimart product/service → BlueDart ProductCode (A=Apex/air, D=Domestic Priority/surface). */
  private bdProductCode(s: any): string {
    const p = String(s.product ?? '').toUpperCase();
    if (BLUEDART.productMap[p]) return BLUEDART.productMap[p];
    const air = /AIR|EXP|APEX/i.test(String(s.serviceMode ?? '') + p);
    return air ? 'A' : 'D';
  }

  /** BlueDart→Logimart pay-mode → SubProductCode: P=Prepaid, C=COD, A=FOD(To-Pay), D=DOD. */
  private bdSubProduct(s: any): string {
    if (s.isDod) return 'D';
    if (String(s.paymentTerm).toUpperCase() === 'TO_PAY') return 'A';
    return 'P';
  }

  /** Map Logimart shipment → BlueDart GenerateWayBill request (TSD v2.7). */
  private mapWaybill(s: any) {
    // Dimensions grouped by identical box size, with a Count per size (TSD Dimension object).
    const dimGroups = new Map<string, { Length: number; Breadth: number; Height: number; Count: number }>();
    for (const p of s.pieces ?? []) {
      const L = Number(p.lengthCm || 0), B = Number(p.widthCm || 0), H = Number(p.heightCm || 0);
      if (!(L && B && H)) continue;
      const k = `${L}x${B}x${H}`;
      const g = dimGroups.get(k) ?? { Length: L, Breadth: B, Height: H, Count: 0 };
      g.Count += 1; dimGroups.set(k, g);
    }
    const dims = [...dimGroups.values()];
    const codAmount = s.isDod ? Number(s.dodAmount || 0) : (String(s.paymentTerm).toUpperCase() === 'TO_PAY' ? Number(s.freightToCollect || 0) : 0);

    return {
      Request: {
        Shipper: {
          OriginArea: BLUEDART.originArea || String(s.originZone ?? '').slice(0, 3).toUpperCase(),
          CustomerCode: BLUEDART.customerCode || BLUEDART.loginId,
          CustomerName: (s.shipperName ?? s.client?.legalName ?? '').slice(0, 30),
          CustomerAddress1: (s.shipperAddress1 ?? s.client?.addressLine ?? '').slice(0, 30),
          CustomerAddress2: (s.shipperAddress2 ?? '').slice(0, 30),
          CustomerPincode: s.shipperPincode ?? s.client?.pincode ?? '',
          CustomerMobile: s.shipperContact ?? s.client?.contactPhone ?? '',
          CustomerGSTNumber: s.consignorGstin ?? s.client?.gstin ?? '',
          Sender: (s.shipperName ?? s.client?.legalName ?? '').slice(0, 20),
          isToPayCustomer: false,
        },
        Consignee: {
          ConsigneeName: (s.consigneeName ?? '').slice(0, 30),
          ConsigneeAddress1: (s.consigneeAddress ?? '').slice(0, 30),
          ConsigneeAddress2: (s.consigneeCity ?? '').slice(0, 30),
          ConsigneePincode: s.destPincode ?? '',
          ConsigneeMobile: s.consigneePhone ?? '',
          ConsigneeAttention: (s.consigneeName ?? '').slice(0, 30),
        },
        Services: {
          ProductCode: this.bdProductCode(s),
          ProductType: String(s.docType ?? '').toUpperCase().includes('DOC') ? 0 : 1, // 0=Docs, 1=Dutiables
          SubProductCode: this.bdSubProduct(s),
          PieceCount: Number(s.pieceCount ?? 1),
          ActualWeight: Number(Number(s.chargeWeight ?? s.totalDeadKg ?? 0).toFixed(2)),
          DeclaredValue: Number(Number(s.shipmentValue ?? s.declaredValue ?? 0).toFixed(2)),
          CollactableAmount: Number(codAmount.toFixed(2)),
          CreditReferenceNo: String(s.awb).slice(0, 20), // must be UNIQUE — our AWB
          Dimensions: dims,
          PickupDate: Date.now(), // epoch ms
          PickupTime: BLUEDART.pickupTime,
          RegisterPickup: false,
          PDFOutputNotRequired: false,
          InvoiceNo: (s.referenceNo ?? '').slice(0, 10),
        },
      },
      Profile: { LoginID: BLUEDART.loginId, LicenceKey: BLUEDART.licKey, Api_type: 'S' },
    };
  }

  /** Register a pickup with BlueDart (RegisterPickup). Request shape finalized on UAT. */
  async registerPickup(body: any) {
    this.ensure();
    return this.authed('/pickup/v1/RegisterPickup', { method: 'POST', body: JSON.stringify({ request: body, Profile: { LoginID: BLUEDART.loginId, LicenceKey: BLUEDART.licKey } }) });
  }

  /** Pull the latest BlueDart status into the Logimart shipment. Parses the custawbquery XML
   *  (<Status>, <StatusDate>) from the tracking response. */
  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { bdWaybill: true } });
    const track = s?.bdWaybill || awb;
    const r = await this.track(track);
    const raw = typeof r?.raw === 'string' ? r.raw : (typeof r === 'string' ? r : JSON.stringify(r));
    const grab = (tag: string) => { const m = raw.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i')); return m ? m[1].trim() : null; };
    const bdStatus = grab('Status') || grab('StatusType');
    const bdStatusDate = grab('StatusDate');
    if (bdStatus) await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus } });
    return { awb, bdStatus, bdStatusDate, tracking: r };
  }
}
