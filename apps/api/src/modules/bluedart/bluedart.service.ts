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
    const q = `/tracking/v1?handler=tnt&action=custawbquery&loginid=${encodeURIComponent(BLUEDART.loginId)}&numbers=${encodeURIComponent(awb)}&format=xml&lickey=${encodeURIComponent(BLUEDART.licKey)}&verno=1&scan=1`;
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
    const bdWaybill = resp?.GenerateWayBillResult?.AWBNo || resp?.AWBNo || resp?.awbNo || null;
    if (bdWaybill) await this.prisma.shipment.update({ where: { id: s.id }, data: { bdWaybill, bdHandedAt: new Date() } });
    return { awb, bdWaybill, response: resp };
  }

  private mapWaybill(s: any) {
    // TODO(bluedart): finalize exact field names/casing against the TSD GenerateWayBill
    // request during UAT. This is the Logimart -> BlueDart field mapping.
    return {
      Request: {
        Consignee: {
          ConsigneeName: s.consigneeName ?? '',
          ConsigneeAddress1: s.consigneeAddress ?? '',
          ConsigneePincode: s.destPincode ?? '',
          ConsigneeMobile: s.consigneePhone ?? '',
        },
        Shipper: { CustomerName: s.client?.legalName ?? '', CustomerCode: BLUEDART.loginId, OriginArea: s.originZone ?? '' },
        Services: {
          ProductCode: s.product ?? 'D',
          PieceCount: String(s.pieceCount ?? 1),
          ActualWeight: String(s.totalDeadKg ?? 0),
          DeclaredValue: String(s.declaredValue ?? 0),
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

  /** Pull the latest BlueDart status into the Logimart shipment. */
  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { bdWaybill: true } });
    const track = s?.bdWaybill || awb;
    const r = await this.track(track);
    const raw = typeof r?.raw === 'string' ? r.raw : '';
    const m = raw.match(/<Status[^>]*>([^<]+)<\/Status>/i) || raw.match(/<StatusType[^>]*>([^<]+)<\/StatusType>/i);
    const bdStatus = m ? m[1] : null;
    if (bdStatus) await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus } });
    return { awb, bdStatus, tracking: r };
  }
}
