import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BLUEDART, bdConfigured } from './bluedart.config';

@Injectable()
export class BluedartService implements OnModuleInit {
  private readonly logger = new Logger('BlueDart');
  private autoSyncing = false;
  constructor(private readonly prisma: PrismaService) {}

  /** Periodically pull BlueDart tracking for open (handed-off, not-yet-delivered) shipments,
   *  so the tracking timeline stays live without anyone clicking. Interval-based (single pm2 instance);
   *  set BLUEDART_SYNC_INTERVAL_MIN=0 to disable. */
  onModuleInit() {
    if (!bdConfigured()) return;
    const mins = Number(process.env.BLUEDART_SYNC_INTERVAL_MIN ?? 15);
    if (!(mins > 0)) return;
    const timer = setInterval(() => this.autoSync().catch((e) => this.logger.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (timer as any).unref?.();
    setTimeout(() => this.autoSync().catch(() => {}), 60_000); // first pass a minute after boot
    this.logger.log(`BlueDart tracking auto-sync every ${mins} min.`);
  }

  /** One auto-sync pass: sync recent, non-terminal BlueDart shipments (throttled, best-effort). */
  async autoSync() {
    if (this.autoSyncing || !bdConfigured()) return;
    this.autoSyncing = true;
    try {
      const since = new Date(Date.now() - 30 * 864e5); // handed off within the last 30 days
      const rows = await this.prisma.shipment.findMany({
        where: { bdWaybill: { not: null }, bdHandedAt: { gte: since } },
        select: { awb: true, bdStatus: true },
        orderBy: { bdSyncedAt: 'asc' }, take: 300,
      });
      const terminal = (st?: string | null) => !!st && /deliv|dlvd|\bdl\b|cancel|rto|returned to origin/i.test(st);
      const open = rows.filter((r) => !terminal(r.bdStatus));
      let synced = 0;
      for (const r of open) {
        try { await this.syncTracking(r.awb); synced++; } catch { /* keep going */ }
        await new Promise((res) => setTimeout(res, 400)); // gentle on the carrier API
      }
      if (synced) this.logger.log(`Auto-synced ${synced}/${open.length} BlueDart shipment(s).`);
    } finally {
      this.autoSyncing = false;
    }
  }

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
    const q = `/tracking/v1?handler=tnt&action=custawbquery&loginid=${encodeURIComponent(BLUEDART.trackLoginId)}&awb=awb&numbers=${encodeURIComponent(awb)}&format=xml&lickey=${encodeURIComponent(BLUEDART.trackLicKey)}&verno=1&scan=1`;
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

  /** Resolve a pincode's BlueDart area + service-centre codes from serviceability (AreaCode/ServiceCenterCode).
   *  `label` is "AREA / SC" (e.g. "BOM / SAK") for the shipping label. */
  private async areaInfoFor(pincode?: string | null): Promise<{ area: string; sc: string; label: string }> {
    if (pincode) {
      try {
        const svc = await this.serviceability(String(pincode).trim());
        const res = svc?.GetServicesforPincodeResult ?? svc;
        const area = String(res?.AreaCode ?? res?.areaCode ?? '').toUpperCase();
        const sc = String(res?.ServiceCenterCode ?? res?.serviceCenterCode ?? '').toUpperCase();
        if (area || sc) return { area: area || BLUEDART.originArea, sc, label: [area, sc].filter(Boolean).join(' / ') };
      } catch { /* fall through to the configured default */ }
    }
    return { area: BLUEDART.originArea, sc: '', label: BLUEDART.originArea };
  }

  /** Origin area code for the waybill OriginArea field. */
  private async originAreaFor(pincode?: string | null): Promise<string> {
    return (await this.areaInfoFor(pincode)).area;
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
    // OriginArea must be the pickup pincode's BlueDart area code (e.g. DEL/BOM/BLR) — a fixed default
    // gives "InvalidAreaScNotInRegion" for any out-of-area origin. Derive it from serviceability's AreaCode.
    // Also capture origin+dest "AREA / SC" codes for the shipping label (ORG/DST line).
    const org = await this.areaInfoFor((s as any).shipperPincode ?? (s as any).client?.pincode);
    const dst = await this.areaInfoFor((s as any).destPincode);
    const payload = this.mapWaybill(s, org.area);
    const resp = await this.authed('/waybill/v1/GenerateWayBill', { method: 'POST', body: JSON.stringify(payload) });
    // APIGEE wraps the TSD WayBillGenerationResponse in GenerateWayBillResult{ AWBNo, IsError,
    // Status[]{StatusCode,StatusInformation}, TokenNumber, AWBPrintContent }. Unwrap it for both
    // the success AWB and the error message (verified live: /Date(ms)/ pickup, numeric fields).
    const result = resp?.GenerateWayBillResult ?? resp;
    if (result?.IsError === true || result?.isError === true) {
      const msg = (result?.Status ?? result?.status ?? [])
        .map((x: any) => x?.StatusInformation ?? x?.statusInformation ?? x?.StatusCode)
        .filter(Boolean).join('; ');
      throw new BadRequestException(`BlueDart rejected the waybill: ${msg || JSON.stringify(result).slice(0, 300)}`);
    }
    const bdWaybill = result?.AWBNo || result?.awbNo || null;
    const label = result?.AWBPrintContent ?? result?.awbPrintContent ?? null;
    if (bdWaybill) {
      await this.prisma.shipment.update({
        where: { id: s.id },
        // Capture BlueDart's official AWB print (base64) — GenerateWayBill is the only place it's
        // returned (can't re-generate: CreditReferenceNo must be unique), so store it now.
        data: { bdWaybill, forwardingAwb: (s as any).forwardingAwb ?? bdWaybill, vendor: (s as any).vendor ?? 'BLUEDART', bdHandedAt: new Date(), ...(label ? { bdLabel: label } : {}), ...(org.label ? { bdRouteOrg: org.label } : {}), ...(dst.label ? { bdRouteDst: dst.label } : {}) },
      });
    }
    return { awb, bdWaybill, token: result?.TokenNumber ?? null, labelBase64: label, response: resp };
  }

  /** Return the stored BlueDart official AWB print (base64) for a shipment. */
  async label(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { bdWaybill: true, bdLabel: true } });
    if (!s?.bdLabel) throw new BadRequestException(`No BlueDart label stored for ${awb} — hand it off to BlueDart first.`);
    return { awb, bdWaybill: s.bdWaybill, label: s.bdLabel };
  }

  /** Cancel a BlueDart waybill — only valid BEFORE the shipment is manifested/in-scanned (TSD CancelWaybill).
   *  Accepts our AWB (resolves the stored bdWaybill) or a BlueDart waybill number directly. */
  async cancelWaybill(awb: string) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, bdWaybill: true } });
    const bd = s?.bdWaybill || awb;
    const resp = await this.authed('/waybill/v1/CancelWaybill', {
      method: 'POST',
      body: JSON.stringify({ Request: { AWBNo: bd }, Profile: { LoginID: BLUEDART.loginId, LicenceKey: BLUEDART.licKey, Api_type: 'S' } }),
    });
    // Response wrapped in CancelWaybillResult{ AWBNo, IsError, Status[]{StatusCode,StatusInformation} }.
    const result = resp?.CancelWaybillResult ?? resp;
    if (result?.IsError === true || result?.isError === true) {
      const msg = (result?.Status ?? result?.status ?? [])
        .map((x: any) => x?.StatusInformation ?? x?.statusInformation ?? x?.StatusCode)
        .filter(Boolean).join('; ');
      throw new BadRequestException(`BlueDart cancel failed: ${msg || JSON.stringify(result).slice(0, 300)}`);
    }
    if (s) await this.prisma.shipment.update({ where: { id: s.id }, data: { bdStatus: 'CANCELLED' } });
    const message = (result?.Status ?? []).map((x: any) => x?.StatusInformation).filter(Boolean).join('; ');
    return { awb, bdWaybill: bd, cancelled: true, message };
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
  private mapWaybill(s: any, originArea?: string) {
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
          OriginArea: originArea || BLUEDART.originArea || String(s.originZone ?? '').slice(0, 3).toUpperCase(),
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
          PickupDate: `/Date(${Date.now()})/`, // BlueDart wants the .NET epoch STRING, not a raw number (verified live — raw number → HTTP 500)
          PickupTime: BLUEDART.pickupTime,
          RegisterPickup: false,
          PDFOutputNotRequired: false,
          InvoiceNo: (s.referenceNo ?? '').slice(0, 10),
        },
      },
      Profile: { LoginID: BLUEDART.loginId, LicenceKey: BLUEDART.licKey, Api_type: 'S' },
    };
  }

  /** Raw RegisterPickup pass-through (advanced/manual use). */
  async registerPickup(body: any) {
    this.ensure();
    return this.authed('/pickup/v1/RegisterPickup', { method: 'POST', body: JSON.stringify({ Request: body, Profile: { LoginID: BLUEDART.loginId, LicenceKey: BLUEDART.licKey, Api_type: 'S' } }) });
  }

  /** Schedule a BlueDart pickup for a Logimart shipment (RegisterPickup) — maps the shipper's
   *  address/pincode/contact from the shipment. dto: { date?, time?, remarks? }. */
  async schedulePickup(awb: string, dto: { date?: string; time?: string; remarks?: string } = {}) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true } }) as any;
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    const pin = s.shipperPincode ?? s.client?.pincode ?? '';
    const areaCode = await this.originAreaFor(pin);
    const phone = String(s.shipperContact ?? s.client?.contactPhone ?? '').replace(/\D/g, '');
    const when = dto.date ? new Date(dto.date) : new Date();
    // ShipmentPickupTime is "HH:MM"; BLUEDART_PICKUP_TIME is stored HHMM.
    const time = dto.time || String(BLUEDART.pickupTime || '1600').replace(/^(\d{2})(\d{2})$/, '$1:$2');
    const request = {
      ProductCode: this.bdProductCode(s),
      AreaCode: areaCode,
      CustomerCode: BLUEDART.customerCode || BLUEDART.loginId,
      CustomerName: String(s.shipperName ?? s.client?.legalName ?? '').slice(0, 30),
      CustomerAddress1: String(s.shipperAddress1 ?? s.client?.addressLine ?? '').slice(0, 30),
      CustomerAddress2: String(s.shipperAddress2 ?? '').slice(0, 30),
      CustomerAddress3: String(s.shipperCity ?? '').slice(0, 30),
      ContactPersonName: String(s.shipperName ?? s.client?.legalName ?? '').slice(0, 30),
      CustomerPincode: String(pin),
      CustomerTelephoneNumber: phone,
      MobileTelNo: phone,
      ShipmentPickupDate: `/Date(${when.getTime()})/`,
      ShipmentPickupTime: time,
      Remarks: String(dto.remarks ?? '').slice(0, 60),
      NumberofPieces: Number(s.pieceCount ?? 1),
      WeightofShipment: Number(Number(s.chargeWeight ?? s.totalDeadKg ?? 1).toFixed(2)),
    };
    const resp = await this.authed('/pickup/v1/RegisterPickup', {
      method: 'POST',
      body: JSON.stringify({ Request: request, Profile: { LoginID: BLUEDART.loginId, LicenceKey: BLUEDART.licKey, Api_type: 'S' } }),
    });
    const result = resp?.RegisterPickupResult ?? resp;
    if (result?.IsError === true || result?.isError === true) {
      const msg = (result?.Status ?? result?.status ?? [])
        .map((x: any) => x?.StatusInformation ?? x?.statusInformation ?? x?.StatusCode)
        .filter(Boolean).join('; ');
      throw new BadRequestException(`BlueDart pickup failed: ${msg || JSON.stringify(result).slice(0, 300)}`);
    }
    const token = result?.TokenNumber ?? result?.tokenNumber ?? null;
    if (token) await this.prisma.shipment.update({ where: { id: s.id }, data: { bdPickupToken: String(token), bdPickupAt: when } });
    return { awb, token, pickupDate: when, response: resp };
  }

  /** Parse the custawbquery XML into a flat scan list (newest first), plus the current status. */
  private parseScans(raw: string) {
    const grab = (xml: string, tag: string) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i')); return m ? m[1].trim() : null; };
    const scans: { scan: string | null; type: string | null; date: string | null; time: string | null; location: string | null; locationCode: string | null }[] = [];
    const re = /<ScanDetail[^>]*>([\s\S]*?)<\/ScanDetail>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const x = m[1];
      scans.push({
        scan: grab(x, 'Scan'), type: grab(x, 'ScanType'),
        date: grab(x, 'ScanDate'), time: grab(x, 'ScanTime'),
        location: grab(x, 'ScannedLocation'), locationCode: grab(x, 'ScannedLocationCode'),
      });
    }
    // BlueDart lists scans newest-first; the top one is the current status.
    const bdStatus = scans[0]?.scan || grab(raw, 'Status') || grab(raw, 'StatusType');
    const bdStatusDate = scans[0]?.date || grab(raw, 'StatusDate');
    return { scans, bdStatus, bdStatusDate };
  }

  /** Pull BlueDart tracking into the Logimart shipment — stores the current status and the full
   *  scan history (JSON) parsed from the custawbquery XML. */
  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { bdWaybill: true } });
    const track = s?.bdWaybill || awb;
    const r = await this.track(track);
    const raw = typeof r?.raw === 'string' ? r.raw : (typeof r === 'string' ? r : JSON.stringify(r));
    const { scans, bdStatus, bdStatusDate } = this.parseScans(raw);
    await this.prisma.shipment.updateMany({
      where: { awb },
      data: { ...(bdStatus ? { bdStatus } : {}), ...(scans.length ? { bdScans: JSON.stringify(scans) } : {}), bdSyncedAt: new Date() },
    });
    return { awb, bdStatus, bdStatusDate, scans, tracking: r };
  }
}
