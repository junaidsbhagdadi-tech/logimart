import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BLUEDART, bdConfigured } from './bluedart.config';
import { deriveStatusFromBd, isFinalBdStatus } from './bd-status';

/** The BlueDart account a shipment books under — its login + licence key + customer code + origin area. */
interface BdAcc { loginId: string; licKey: string; customerCode: string; originArea: string; }

@Injectable()
export class BluedartService implements OnModuleInit {
  private readonly logger = new Logger('BlueDart');
  private autoSyncing = false;
  private backfilling = false;
  private dispatching = false;
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
    // Auto-dispatch: hand booked BlueDart shipments off to BD (generate AWB + register pickup) without
    // anyone clicking. Covers single AND bulk bookings. Set BLUEDART_DISPATCH_INTERVAL_MIN=0 to disable.
    const dmins = Number(process.env.BLUEDART_DISPATCH_INTERVAL_MIN ?? 5);
    if (dmins > 0) {
      const dtimer = setInterval(() => this.dispatchPending().catch((e) => this.logger.warn(`auto-dispatch: ${e?.message || e}`)), dmins * 60_000);
      (dtimer as any).unref?.();
      setTimeout(() => this.dispatchPending().catch(() => {}), 90_000); // first pass ~1.5 min after boot
      this.logger.log(`BlueDart auto-dispatch every ${dmins} min.`);
    }
  }

  /** One auto-sync pass: sync recent, non-terminal BlueDart shipments (throttled, best-effort). */
  async autoSync() {
    if (this.autoSyncing || !bdConfigured()) return;
    this.autoSyncing = true;
    try {
      const since = new Date(Date.now() - 30 * 864e5); // booked within the last 30 days
      const codes = await this.bdVendorCodes(); // per-account BlueDart vendors count as BlueDart too
      // Cover every way a shipment is on BlueDart: our API hand-off (bdWaybill), ops recording the
      // carrier AWB manually via "Forward to vendor" (forwardingAwb, vendor BDR/BLUEDART), AND a
      // registered pickup with no waybill yet (bdPickupToken) — syncTracking discovers its waybill
      // by our reference once BlueDart collects it.
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: since },
          // Only shipments still OPEN on our side. Finished ones were selected too, never re-synced (so their
          // bdSyncedAt stayed oldest) and permanently filled the 300 slots — open shipments went stale.
          AND: [{ OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] }],
          OR: [
            { bdWaybill: { not: null } },
            { AND: [{ forwardingAwb: { not: null } }, { OR: [{ vendor: { startsWith: 'BLUE', mode: 'insensitive' } }, { vendor: { equals: 'BDR', mode: 'insensitive' } }, ...(codes.length ? [{ vendor: { in: codes } }] : [])] }] },
            { bdPickupToken: { not: null } },
          ],
        },
        select: { awb: true, bdStatus: true },
        orderBy: { bdSyncedAt: { sort: 'asc', nulls: 'first' } }, take: 300,
      });
      // Stop polling only once the carrier status is FINAL (delivered / back with shipper / cancelled).
      // The old /deliv/ test also matched "OUT FOR DELIVERY" / "UNDELIVERED" → those were never re-synced.
      const open = rows.filter((r) => !isFinalBdStatus(r.bdStatus));
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

  /** Hand a single booked BlueDart shipment off to BD — generate the AWB (which also registers the
   *  pickup via RegisterPickup:true). Idempotent (skips if already handed off). For an out-of-area
   *  origin that can't generate a waybill, falls back to an outstation to-pay pickup so BD still gets
   *  the collection request. Any failure is captured on the shipment (bdError) for retry. */
  async autoDispatch(awb: string): Promise<{ awb: string; ok: boolean; action: string; bdWaybill?: string | null; token?: string | null; error?: string }> {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, vendor: true, bdWaybill: true, forwardingAwb: true, statusCode: true, bdPickupToken: true } });
    if (!s) return { awb, ok: false, action: 'skip', error: 'not found' };
    if (!(await this.isBlueDartVendor(s.vendor))) return { awb, ok: false, action: 'skip', error: 'not a BlueDart shipment' };
    if (String(s.statusCode).toUpperCase() === 'CAN') return { awb, ok: false, action: 'skip', error: 'cancelled' };
    if (s.bdWaybill) return { awb, ok: true, action: 'already', bdWaybill: s.bdWaybill };
    // Safety: a shipment that already carries a carrier AWB (recorded manually as forwardingAwb) must
    // NOT get a freshly-generated waybill — that would duplicate the AWB. Auto-dispatch only creates
    // waybills for shipments with no carrier number yet.
    if (s.forwardingAwb) return { awb, ok: true, action: 'already', bdWaybill: s.forwardingAwb };
    // A pickup is already registered (e.g. an out-of-area to-pay pickup): BlueDart assigns the waybill at
    // collection and tracking-by-reference picks it up. Re-dispatching registered a NEW pickup every hour.
    if (s.bdPickupToken) return { awb, ok: true, action: 'already', token: s.bdPickupToken };
    await this.prisma.shipment.update({ where: { id: s.id }, data: { bdDispatchAt: new Date() } }).catch(() => {});
    try {
      const r = await this.generateWaybill(awb); // generates AWB + schedules pickup (RegisterPickup:true)
      return { awb, ok: true, action: 'waybill', bdWaybill: r.bdWaybill, token: r.token };
    } catch (e: any) {
      const msg = String(e?.message || e);
      // Out-of-area origin can't generate a waybill — register an outstation (to-pay) pickup instead,
      // so BlueDart still receives the collection request.
      if (/area|region|UnauthorizedUser|not authorized/i.test(msg)) {
        try {
          const pk = await this.schedulePickup(awb);
          await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: null } }).catch(() => {});
          return { awb, ok: true, action: 'outstation-pickup', token: pk.token };
        } catch (e2: any) {
          const m2 = String(e2?.message || e2);
          await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: m2.slice(0, 500) } }).catch(() => {});
          return { awb, ok: false, action: 'failed', error: m2 };
        }
      }
      await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: msg.slice(0, 500) } }).catch(() => {});
      return { awb, ok: false, action: 'failed', error: msg };
    }
  }

  /** Dispatch pending BlueDart shipments (booked, vendor BlueDart, no waybill yet) — throttled, from
   *  the poller and the manual "Send to BlueDart" button. `force` retries ones that failed recently;
   *  otherwise a failed shipment is paced (retried only after ~1h) so a bad-data row isn't re-hammered. */
  async dispatchPending(opts: { limit?: number; force?: boolean } = {}) {
    if (this.dispatching || !bdConfigured()) return { started: false, running: this.dispatching, total: 0, ok: 0, failed: 0 };
    this.dispatching = true;
    try {
      const since = new Date(Date.now() - 30 * 864e5);
      const retryBefore = new Date(Date.now() - 60 * 60_000);
      const codes = await this.bdVendorCodes();
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: since }, bdWaybill: null, forwardingAwb: null, bdPickupToken: null, statusCode: { not: 'CAN' },
          AND: [
            { OR: [{ vendor: { startsWith: 'BLUE', mode: 'insensitive' } }, { vendor: { equals: 'BDR', mode: 'insensitive' } }, ...(codes.length ? [{ vendor: { in: codes } }] : [])] },
            ...(opts.force ? [] : [{ OR: [{ bdDispatchAt: null }, { bdDispatchAt: { lt: retryBefore } }] }]),
          ],
        },
        select: { awb: true }, orderBy: { createdAt: 'asc' }, take: Math.min(opts.limit ?? 200, 1000),
      });
      let ok = 0, failed = 0;
      for (const r of rows) {
        const res = await this.autoDispatch(r.awb).catch(() => ({ ok: false }));
        if ((res as any).ok) ok++; else failed++;
        await new Promise((res2) => setTimeout(res2, 500)); // gentle on BD
      }
      if (rows.length) this.logger.log(`BlueDart auto-dispatch: ${ok} sent, ${failed} failed of ${rows.length}.`);
      return { started: true, total: rows.length, ok, failed };
    } finally {
      this.dispatching = false;
    }
  }

  /** Count of BlueDart shipments still awaiting dispatch (no waybill) + how many have a failure. */
  async dispatchStatus() {
    const codes = await this.bdVendorCodes();
    const base = { bdWaybill: null, forwardingAwb: null, bdPickupToken: null, statusCode: { not: 'CAN' }, OR: [{ vendor: { startsWith: 'BLUE', mode: 'insensitive' as const } }, { vendor: { equals: 'BDR', mode: 'insensitive' as const } }, ...(codes.length ? [{ vendor: { in: codes } }] : [])] };
    const [pending, failed] = await Promise.all([
      this.prisma.shipment.count({ where: base as any }),
      this.prisma.shipment.count({ where: { AND: [base, { bdError: { not: null } }] } as any }),
    ]);
    return { pending, failed, running: this.dispatching };
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
    if (!res.ok) {
      // Pull BlueDart's own reason(s) out of the error body (Status[].StatusInformation) so the message
      // is readable and never cut off mid-sentence; keep more of the raw body for diagnosis.
      let reason = '';
      try {
        const j = JSON.parse(text);
        const arr = [j?.['error-response'], j?.errorResponse, j?.GenerateWayBillResult, j].flat().filter(Boolean);
        const msgs = arr.flatMap((e: any) => (Array.isArray(e?.Status) ? e.Status : []).map((x: any) => [x?.StatusCode, x?.StatusInformation].filter(Boolean).join(': ')));
        reason = [...new Set(msgs)].filter(Boolean).join('; ');
      } catch { /* not JSON */ }
      throw new BadRequestException(`BlueDart ${res.status}: ${reason || text.slice(0, 1200)}`);
    }
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  /** Tracking — shipment details/status for a BlueDart waybill (returns XML in `raw`).
   *  `by='reference'` queries by OUR reference number (CreditReferenceNo / pickup ReferenceNo =
   *  our AWB) instead of the BlueDart waybill — the response still carries WaybillNo + all scans,
   *  so it's how a pickup-only shipment (token, no waybill yet) discovers its assigned waybill.
   *  (Verified live: awb=reference&numbers=<ref> returns the same WaybillNo as the waybill query.) */
  async track(numbers: string, by: 'awb' | 'reference' = 'awb') {
    this.ensure();
    // TSD tracking URL: handler=tnt, action=custawbquery, awb=awb|reference, numbers=<value>, format=xml, scan=1 (all scans).
    const q = `/tracking/v1?handler=tnt&action=custawbquery&loginid=${encodeURIComponent(BLUEDART.trackLoginId)}&awb=${by}&numbers=${encodeURIComponent(numbers)}&format=xml&lickey=${encodeURIComponent(BLUEDART.trackLicKey)}&verno=1&scan=1`;
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

  /** Resolve which BlueDart account a shipment books under: its manual pick (bdAccountId), else the
   *  default configured account, else the single env account. */
  /** Vendor codes that ARE BlueDart accounts (the per-account vendors: 476954, 439154, O06392, …). */
  async bdVendorCodes(): Promise<string[]> {
    const rows = await this.prisma.bdAccount.findMany({ where: { active: true }, select: { customerCode: true, accountCode: true } }).catch(() => [] as any[]);
    return [...new Set(rows.flatMap((r: any) => [r.customerCode, r.accountCode]).filter(Boolean).map((x: string) => String(x).trim()))];
  }

  /** Is this vendor BlueDart — the generic BDR/BLUEDART code OR one of the per-account BlueDart vendors? */
  async isBlueDartVendor(vendor?: string | null): Promise<boolean> {
    const v = String(vendor ?? '').trim();
    if (!v) return false;
    if (/^(BLUE|BDR)/i.test(v)) return true;
    return (await this.bdVendorCodes()).some((c) => c.toUpperCase() === v.toUpperCase());
  }

  private async resolveAccount(shipment?: { bdAccountId?: bigint | null; vendor?: string | null } | null): Promise<BdAcc> {
    if (shipment?.bdAccountId != null) {
      const a = await this.prisma.bdAccount.findUnique({ where: { id: shipment.bdAccountId } }).catch(() => null);
      if (a && a.active) return { loginId: a.loginId, licKey: a.licKey, customerCode: a.customerCode, originArea: a.areaCode };
    }
    // Per-account BlueDart VENDORS: the vendor code IS the BlueDart customer code (476954 = "BDR BOM LOGM",
    // 439154 = "BDR BOM XLX", …). Book under that account — previously the vendor was ignored and every
    // hand-off went out on the fallback account (wrong customer code → wrong BD billing / rejections).
    const v = String(shipment?.vendor ?? '').trim();
    if (v && !/^(BDR|BLUE ?DART|BLUEDART)$/i.test(v)) {
      const byVendor = await this.prisma.bdAccount.findFirst({
        where: { active: true, OR: [{ customerCode: { equals: v, mode: 'insensitive' } }, { accountCode: { equals: v, mode: 'insensitive' } }] },
      }).catch(() => null);
      if (byVendor) return { loginId: byVendor.loginId, licKey: byVendor.licKey, customerCode: byVendor.customerCode, originArea: byVendor.areaCode };
    }
    const def = await this.prisma.bdAccount.findFirst({ where: { isDefault: true, active: true } }).catch(() => null);
    if (def) return { loginId: def.loginId, licKey: def.licKey, customerCode: def.customerCode, originArea: def.areaCode };
    return { loginId: BLUEDART.loginId, licKey: BLUEDART.licKey, customerCode: BLUEDART.customerCode || BLUEDART.loginId, originArea: BLUEDART.originArea };
  }

  /** List / upsert / delete BlueDart accounts (admin config of all account codes). */
  async listAccounts() {
    const rows = await this.prisma.bdAccount.findMany({ orderBy: [{ isDefault: 'desc' }, { areaCode: 'asc' }] });
    // Don't leak full licence keys to the browser — show a fingerprint only.
    return rows.map((a) => ({ id: a.id.toString(), label: a.label, accountCode: a.accountCode, areaCode: a.areaCode, loginId: a.loginId, customerCode: a.customerCode, licKeySet: !!a.licKey, licKeyLast4: a.licKey ? a.licKey.slice(-4) : null, trackLoginId: a.trackLoginId, trackLicKeySet: !!a.trackLicKey, isDefault: a.isDefault, active: a.active }));
  }
  /** Accounts for the booking-screen picker (no secrets). */
  async accountOptions() {
    const rows = await this.prisma.bdAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { areaCode: 'asc' }], select: { id: true, label: true, accountCode: true, areaCode: true, customerCode: true, isDefault: true } });
    return rows.map((a) => ({ id: a.id.toString(), label: a.label, accountCode: a.accountCode, areaCode: a.areaCode, customerCode: a.customerCode, isDefault: a.isDefault }));
  }
  async upsertAccount(dto: any) {
    const data: any = {
      label: String(dto.label || '').trim() || `${dto.areaCode} ${dto.customerCode}`,
      accountCode: dto.accountCode || null,
      areaCode: String(dto.areaCode || '').trim().toUpperCase(),
      loginId: String(dto.loginId || '').trim(),
      customerCode: String(dto.customerCode || '').trim(),
      trackLoginId: dto.trackLoginId || null,
      isDefault: !!dto.isDefault,
      active: dto.active !== false,
    };
    if (!data.areaCode || !data.loginId || !data.customerCode) throw new BadRequestException('Area code, login id and customer code are required.');
    // Only overwrite the keys when provided (so editing without re-typing keeps them).
    if (dto.licKey) data.licKey = String(dto.licKey).trim();
    if (dto.trackLicKey !== undefined) data.trackLicKey = dto.trackLicKey ? String(dto.trackLicKey).trim() : null;
    if (!dto.id && !data.licKey) throw new BadRequestException('Shipping licence key is required for a new account.');
    const a = dto.id ? await this.prisma.bdAccount.update({ where: { id: BigInt(dto.id) }, data }) : await this.prisma.bdAccount.create({ data });
    // Enforce a single default.
    if (a.isDefault) await this.prisma.bdAccount.updateMany({ where: { id: { not: a.id }, isDefault: true }, data: { isDefault: false } });
    return { id: a.id.toString(), ok: true };
  }
  async deleteAccount(id: number) { await this.prisma.bdAccount.delete({ where: { id: BigInt(id) } }); return { ok: true }; }

  /**
   * Hand off a Logimart shipment to BlueDart (GenerateWayBill). The full request has
   * ~40 fields; mapWaybill() is the Logimart→BlueDart mapping, finalized field-by-field
   * against the TSD during UAT. On success we store the BlueDart waybill on the shipment.
   */
  async generateWaybill(awb: string) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true, pieces: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    // Resolve which BlueDart account this shipment books under (manual pick → bdAccountId, else default).
    const acc = await this.resolveAccount(s);
    // Pre-flight: catch the fields BlueDart rejects (Invalid Consignee Name, BlankContactNo, …) with a
    // plain message BEFORE calling the carrier, so ops knows exactly what to fix on Edit AWB.
    const miss = this.bdMissing(s);
    if (miss.length) throw new BadRequestException(`Can't hand off to BlueDart — missing: ${miss.join(', ')}. Fix these on Edit AWB and retry.`);
    // Capture origin+dest "AREA / SC" codes for the shipping label (ORG/DST line).
    const org = await this.areaInfoFor((s as any).shipperPincode ?? (s as any).client?.pincode);
    const dst = await this.areaInfoFor((s as any).destPincode);
    // Pickup OUTSIDE the account's home area = a TO-PAY booking (billed to this account): ask BlueDart for
    // a real waybill: OriginArea = the account's HOME area, CustomerPincode = the remote pickup, IsToPayCustomer. Only if BlueDart refuses it
    // (the account isn't enabled for that area yet) fall back to a pickup-only registration, and say why.
    const home = String(acc.originArea || '').toUpperCase();
    const outstation = !!(home && org.area && org.area.toUpperCase() !== home);
    const pickupOnlyFallback = async (bdRefusal: string) => {
      const pin = (s as any).shipperPincode ?? (s as any).client?.pincode ?? '?';
      try {
        const pk = await this.schedulePickup(awb);
        const reason = `Pickup pincode ${pin} is in BlueDart area ${org.area}, outside this account's home area (${home}). BlueDart refused the to-pay waybill (${bdRefusal}), ` +
          `so only a pickup was registered${pk.token ? ` (token ${pk.token})` : ''} — no AWB. Ask BlueDart to enable to-pay bookings from ${org.area} for account ${acc.customerCode}, or book it under a ${org.area} account.` +
          ((s as any).shipperCity ? ` (Shipper city on the AWB: ${(s as any).shipperCity} — if the pickup is really there, the pincode is wrong.)` : '');
        await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: reason.slice(0, 1000) } }).catch(() => {});
        return { awb, bdWaybill: null, token: pk.token, labelBase64: null, outstation: true, action: 'outstation-pickup', reason, originArea: org.area, accountArea: home, response: pk.response };
      } catch (e: any) {
        throw new BadRequestException(`${awb}: BlueDart refused the to-pay waybill from ${org.area} (${bdRefusal}) and the pickup-only fallback failed too: ${String(e?.message || e)}`);
      }
    };
    const payload = this.mapWaybill(s, acc, outstation ? { outstation: true } : {}); // OriginArea stays the account's home area
    let resp: any;
    try {
      resp = await this.authed('/waybill/v1/GenerateWayBill', { method: 'POST', body: JSON.stringify(payload) });
    } catch (e: any) {
      // Keep BlueDart's reason on the AWB (shown on the shipment page) + which account it went under.
      const m = `${String(e?.message || e)} [account ${acc.customerCode}, origin ${payload.Request.Shipper.OriginArea}; sub-product ${payload.Request.Services.SubProductCode}, to-pay ${payload.Request.Shipper.IsToPayCustomer}, collectable ₹${payload.Request.Services.CollactableAmount}]`;
      if (outstation) return pickupOnlyFallback(m);
      await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: m.slice(0, 1000) } }).catch(() => {});
      throw new BadRequestException(m);
    }
    // APIGEE wraps the TSD WayBillGenerationResponse in GenerateWayBillResult{ AWBNo, IsError,
    // Status[]{StatusCode,StatusInformation}, TokenNumber, AWBPrintContent }. Unwrap it for both
    // the success AWB and the error message (verified live: /Date(ms)/ pickup, numeric fields).
    const result = resp?.GenerateWayBillResult ?? resp;
    if (result?.IsError === true || result?.isError === true) {
      const msg = (result?.Status ?? result?.status ?? [])
        .map((x: any) => x?.StatusInformation ?? x?.statusInformation ?? x?.StatusCode)
        .filter(Boolean).join('; ');
      if (outstation) return pickupOnlyFallback(msg || 'rejected');
      throw new BadRequestException(`BlueDart rejected the waybill: ${msg || JSON.stringify(result).slice(0, 300)}`);
    }
    const bdWaybill = result?.AWBNo || result?.awbNo || null;
    if (!bdWaybill) {
      // BlueDart answered without an error flag but also without an AWB — don't report a silent
      // "success": record what it said on the shipment (bdError) and surface it.
      const said = (result?.Status ?? result?.status ?? []).map((x: any) => x?.StatusInformation ?? x?.statusInformation ?? x?.StatusCode).filter(Boolean).join('; ');
      const msg = `BlueDart returned no waybill${said ? `: ${said}` : ` (response: ${JSON.stringify(result ?? resp).slice(0, 300)})`}`;
      await this.prisma.shipment.update({ where: { id: s.id }, data: { bdError: msg.slice(0, 500) } }).catch(() => {});
      throw new BadRequestException(msg);
    }
    // AWBPrintContent comes back as a byte ARRAY from APIGEE (not a base64 string) — convert it, else
    // storing it into the String column bdLabel throws a Prisma validation error (which previously
    // aborted the whole hand-off AFTER the AWB was already created).
    const labelRaw = result?.AWBPrintContent ?? result?.awbPrintContent ?? null;
    const label = Array.isArray(labelRaw) ? Buffer.from(labelRaw).toString('base64') : (typeof labelRaw === 'string' && labelRaw ? labelRaw : null);
    if (bdWaybill) {
      await this.prisma.shipment.update({
        where: { id: s.id },
        // Capture BlueDart's official AWB print (base64) — GenerateWayBill is the only place it's
        // returned (can't re-generate: CreditReferenceNo must be unique), so store it now.
        // GenerateWayBill with RegisterPickup:true also schedules the pickup → capture its token.
        data: { bdWaybill, forwardingAwb: (s as any).forwardingAwb ?? bdWaybill, vendor: (s as any).vendor ?? 'BLUEDART', bdHandedAt: new Date(), bdError: null, ...(result?.TokenNumber ? { bdPickupToken: String(result.TokenNumber), bdPickupAt: new Date() } : {}), ...(label ? { bdLabel: label } : {}), ...(org.label ? { bdRouteOrg: org.label } : {}), ...(dst.label ? { bdRouteDst: dst.label } : {}) },
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
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, bdWaybill: true, bdAccountId: true, vendor: true } });
    const bd = s?.bdWaybill || awb;
    const acc = await this.resolveAccount(s);
    const resp = await this.authed('/waybill/v1/CancelWaybill', {
      method: 'POST',
      body: JSON.stringify({ Request: { AWBNo: bd }, Profile: { LoginID: acc.loginId, LicenceKey: acc.licKey, Api_type: 'S' } }),
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

  /** A clean 10-digit Indian mobile for BlueDart (strips +91 / spaces / dashes, keeps the last 10). */
  private bdMobile(v: any): string { return String(v ?? '').replace(/\D/g, '').slice(-10); }

  /** The pickup/shipper contact number for BlueDart. `shipperContact` often holds the contact-person
   *  NAME (not a number), so we try the real phone fields first and fall back through the account and,
   *  as a last resort, the consignee number — so a pickup never fails just because one field is blank. */
  private bdShipperMobile(s: any): string {
    for (const v of [s.shipperMobile, s.shipperPhone, s.shipperContact, s.client?.contactPhone, s.client?.contactPhone2, s.consigneePhone]) {
      const m = this.bdMobile(v);
      if (m.length >= 10) return m;
    }
    return '';
  }

  /** Required-field check for a BlueDart waybill — returns the human labels of anything missing/invalid. */
  private bdMissing(s: any): string[] {
    const miss: string[] = [];
    const has = (v: any) => v != null && String(v).trim() !== '';
    if (!has(s.consigneeName)) miss.push('Consignee name');
    if (!has(s.consigneeAddress)) miss.push('Consignee address');
    if (!has(s.destPincode)) miss.push('Consignee pincode');
    if (this.bdMobile(s.consigneePhone).length < 10) miss.push('Consignee mobile (10 digits)');
    if (!has(s.shipperName ?? s.client?.legalName)) miss.push('Shipper name');
    if (!has(s.shipperAddress1 ?? s.client?.addressLine)) miss.push('Shipper address');
    if (!has(s.shipperPincode ?? s.client?.pincode)) miss.push('Shipper pincode');
    if (this.bdShipperMobile(s).length < 10) miss.push('Shipper mobile (10 digits)');
    if (!(Number(s.pieceCount) > 0)) miss.push('Piece count');
    if (!(Number(s.chargeWeight ?? s.totalDeadKg) > 0)) miss.push('Weight');
    if (!(Number(s.shipmentValue ?? s.declaredValue) > 0)) miss.push('Declared/shipment value'); // BlueDart requires DeclaredValue > 0
    // DOD goes as SubProductCode D with the draft amount as CollactableAmount — BlueDart rejects ₹0
    // ("InvalidCollectableAmount"). Catch it here with a plain message.
    if (s.isDod && !(Number(s.dodAmount) > 0)) miss.push('DOD amount (cheque/DD value to collect) — or untick DOD if this is not a DOD shipment');
    return miss;
  }

  /** Logimart product/service → BlueDart ProductCode. Verified against live tracking:
   *  A = Dart Apex (air), E = Surface/Ground (Surfaceline), D = Domestic Priority (air express).
   *  Override per product with BLUEDART_PRODUCT_MAP (e.g. "SFC:E,DP:D,APEX:A"). */
  private bdProductCode(s: any): string {
    const p = String(s.product ?? '').toUpperCase();
    if (BLUEDART.productMap[p]) return BLUEDART.productMap[p];
    // Reverse/to-pay variants carry the base product after a TO/T prefix (TODP→DP, TOSFC→SFC, TAPEX→APEX).
    const base = p === 'TODP' ? 'DP' : p === 'TOSFC' ? 'SFC' : p === 'TAPEX' ? 'APEX' : p;
    const sm = String(s.serviceMode ?? '');
    // DP first: a DP booking is AIR_EXPRESS too, so testing AIR first sent every DP out as Apex.
    if (/^(DP|TDD|NDD)$|PRIORITY/i.test(base)) return 'D'; // Domestic Priority (air express / courier)
    if (/AIR|APEX/i.test(sm + base)) return 'A';           // Dart Apex (air)
    return 'E';                                             // Surface / Ground
  }

  /** TO-PAY (BlueDart sense): carriage from OUTSIDE the account's home area, billed to the account
   *  that registers it → `isToPayCustomer: true` with a normal PREPAID sub-product. The to-pay products
   *  (TOSFC / TAPEX / TODP) signal it; an out-of-area pickup is to-pay regardless of product.
   *  NOT the same as FOD (below) — to-pay is never collected from the consignee. */
  private isToPay(s: any): boolean {
    return ['TOSFC', 'TAPEX', 'TODP'].includes(String(s?.product ?? '').toUpperCase());
  }

  /** FOD (Freight On Delivery): freight collected FROM THE CONSIGNEE → SubProductCode A with the amount
   *  to collect. The FOD product, or a shipment booked with the "To-Pay / freight collect" payment term
   *  (Logimart's freightToCollect = what the consignee pays). */
  private isFod(s: any): boolean {
    return String(s?.product ?? '').toUpperCase() === 'FOD' || String(s?.paymentTerm ?? '').toUpperCase() === 'TO_PAY';
  }

  /** SubProductCode (TSD): P=Prepaid, C=COD, A=FOD (consignee pays freight), D=DOD, B=DOD+FOD.
   *  To-pay is NOT a sub-product — it's the isToPayCustomer flag on a prepaid (P) waybill. */
  private bdSubProduct(s: any): string {
    if (s.isDod && this.isFod(s)) return 'B';
    if (s.isDod) return 'D';
    if (this.isFod(s)) return 'A';
    return 'P';
  }

  /** What BlueDart is shown as the shipper: our customer's account code only (e.g. "LOGIMART 111531"). */
  private maskedShipper(s: any): string {
    const code = String(s?.client?.accountCode ?? '').trim();
    return code ? `LOGIMART ${code}` : 'LOGIMART';
  }

  /** Map Logimart shipment → BlueDart GenerateWayBill request (TSD v2.7), under account `acc`. */
  private mapWaybill(s: any, acc: BdAcc, opts: { originArea?: string; outstation?: boolean } = {}) {
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
    // CollactableAmount: the draft value for DOD, the consignee's freight for FOD; to-pay collects nothing.
    const codAmount = s.isDod ? Number(s.dodAmount || 0) : (this.isFod(s) ? Number(s.freightToCollect || 0) : 0);

    return {
      Request: {
        Shipper: {
          // Always the ACCOUNT's home area (BOM) — also for an out-of-area to-pay booking, where the remote
          // pickup goes in CustomerPincode. (Verified live 2026-10-22: home area + remote pincode + the to-pay
          // flag → waybill issued; OriginArea = the pickup's area → "UnauthorizedUser".)
          OriginArea: opts.originArea || acc.originArea || BLUEDART.originArea || String(s.originZone ?? '').slice(0, 3).toUpperCase(),
          CustomerCode: acc.customerCode,
          // BlueDart sees only OUR customer's account code, never the customer's name (address + mobile
          // stay — the pickup needs them).
          CustomerName: this.maskedShipper(s).slice(0, 30),
          CustomerAddress1: (s.shipperAddress1 ?? s.client?.addressLine ?? '').slice(0, 30),
          CustomerAddress2: (s.shipperAddress2 ?? '').slice(0, 30),
          CustomerPincode: s.shipperPincode ?? s.client?.pincode ?? '',
          CustomerMobile: this.bdShipperMobile(s),
          CustomerGSTNumber: s.consignorGstin ?? s.client?.gstin ?? '',
          Sender: this.maskedShipper(s).slice(0, 20),
          // TO-PAY = carriage from outside the account's home area, billed to THIS account (TSD: "when
          // mutually agreed for shipment carriage from any place other than place of contract signup").
          // Set for the to-pay products and for any out-of-area pickup. (Consignee-pays is FOD → SubProduct A.)
          // CAPITAL "I": the APIGEE gateway reads `IsToPayCustomer` (BlueDart's own example); the PDF spec's
          // `isToPayCustomer` is silently ignored — every earlier to-pay attempt went as a normal booking and
          // was refused for the area. Verified live 2026-10-22 on BOM457730 + BOM439154 (BLR/GZB, Surface/Apex).
          IsToPayCustomer: this.isToPay(s) || !!opts.outstation,
        },
        Consignee: {
          ConsigneeName: (s.consigneeName ?? '').slice(0, 30),
          ConsigneeAddress1: (s.consigneeAddress ?? '').slice(0, 30),
          ConsigneeAddress2: (s.consigneeCity ?? '').slice(0, 30),
          ConsigneePincode: s.destPincode ?? '',
          ConsigneeMobile: this.bdMobile(s.consigneePhone),
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
          RegisterPickup: true, // also schedule the BlueDart pickup when the waybill is generated
          PDFOutputNotRequired: false,
          InvoiceNo: (s.referenceNo ?? '').slice(0, 10),
        },
      },
      Profile: { LoginID: acc.loginId, LicenceKey: acc.licKey, Api_type: 'S' },
    };
  }

  /** Flatten a BlueDart Status array/object into a human message. */
  private bdStatusMsg(result: any): string {
    let st = result?.Status ?? result?.status;
    if (st == null) return '';
    if (!Array.isArray(st)) st = [st];
    return st.map((x: any) => (x && (x.StatusInformation ?? x.statusInformation ?? x.StatusCode ?? x.statusCode)) || x).filter(Boolean).join('; ');
  }

  /** The Pickup API (RegisterPickup/CancelPickup) wants a LOWERCASE `request`/`profile` envelope —
   *  UNLIKE the Waybill API's capitalized `Request`/`Profile`. Sending the capitalized shape → HTTP 500.
   *  (Verified against BlueDart's own sample request.) */
  private pickupBody(request: any, acc?: BdAcc) {
    return { request, profile: { Api_type: 'S', LicenceKey: acc?.licKey ?? BLUEDART.licKey, LoginID: acc?.loginId ?? BLUEDART.loginId } };
  }

  /** Raw RegisterPickup pass-through (advanced/manual use). */
  async registerPickup(body: any) {
    this.ensure();
    return this.authed('/pickup/v1/RegisterPickup', { method: 'POST', body: JSON.stringify(this.pickupBody(body)) });
  }

  /** Schedule a BlueDart pickup for a Logimart shipment (RegisterPickup). Maps the shipper's
   *  address/pincode/contact from the shipment. For a TO_PAY shipment it registers a to-pay (FOD)
   *  collection via `isToPayShipper` — which is how BlueDart accepts a pickup from OUTSIDE the
   *  account's home area (verified: AreaCode=<home, e.g. BOM> + a remote pickup pincode +
   *  isToPayShipper=true → InsertSuccess; sending the remote area code → UnauthorizedUser).
   *  dto: { date?, time?, remarks? }. */
  async schedulePickup(awb: string, dto: { date?: string; time?: string; remarks?: string } = {}) {
    this.ensure();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true } }) as any;
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    const acc = await this.resolveAccount(s);
    const pin = String(s.shipperPincode ?? s.client?.pincode ?? '').trim();
    const phone = this.bdShipperMobile(s);
    const when = dto.date ? new Date(dto.date) : new Date();
    // ShipmentPickupTime is "HH:MM"; BLUEDART_PICKUP_TIME is stored HHMM.
    const time = dto.time || String(BLUEDART.pickupTime || '1600').replace(/^(\d{2})(\d{2})$/, '$1:$2');
    const toPay = this.isToPay(s);
    const weight = Number(Number(s.chargeWeight ?? s.totalDeadKg ?? 1).toFixed(2));
    const name = this.maskedShipper(s).slice(0, 30); // account code only — never our customer's name
    const addr1 = String(s.shipperAddress1 ?? s.client?.addressLine ?? '').trim();
    // Pre-flight: a pickup needs a real pickup address + a reachable contact, else BlueDart rejects it
    // (or books a junk collection). Surface the gap plainly instead of a cryptic carrier error.
    const miss: string[] = [];
    if (!pin) miss.push('shipper pincode');
    if (!name) miss.push('shipper name');
    if (phone.length < 10) miss.push('shipper mobile (10 digits)');
    if (!addr1) miss.push('shipper address');
    if (miss.length) throw new BadRequestException(`Can't register the BlueDart pickup — missing: ${miss.join(', ')}. Add the shipper details on Edit AWB, then retry.`);
    // An OUT-OF-AREA (outstation) pickup on a single-area account is ONLY accepted as a To-Pay (FOD)
    // collection — a prepaid outstation pickup → InvalidAreaScNotInRegion. So flag the BlueDart leg
    // to-pay whenever the pickup is outstation OR the shipment itself is To-Pay. This is the CARRIER
    // freight term for the "mutually agreed" outstation carriage; the Logimart customer is still
    // billed per the shipment's own payment term. (areaInfoFor falls back to the home area on any
    // serviceability hiccup → outstation=false → no behaviour change.)
    const home = String(acc.originArea || '').toUpperCase();
    const pickArea = String((await this.areaInfoFor(pin)).area || '').toUpperCase();
    const outstation = !!(home && pickArea && pickArea !== home);
    const isToPayShipper = toPay || outstation;
    // Pickup API uses the ACCOUNT's home area code — NOT the pickup pincode's area. Full field set per
    // BlueDart's sample (missing fields → HTTP 500).
    const request = {
      AWBNo: [''],
      AreaCode: acc.originArea,
      CISDDN: false,
      ContactPersonName: name,
      CustomerAddress1: addr1.slice(0, 30),
      CustomerAddress2: String(s.shipperAddress2 ?? '').slice(0, 30),
      CustomerAddress3: String(s.shipperCity ?? '').slice(0, 30),
      CustomerCode: acc.customerCode,
      CustomerName: name,
      CustomerPincode: pin,
      CustomerTelephoneNumber: phone,
      DoxNDox: String(s.docType ?? '').toUpperCase().includes('DOC') ? '1' : '2',
      EmailID: '',
      IsForcePickup: false,
      IsReversePickup: false,
      MobileTelNo: phone,
      NumberofPieces: Number(s.pieceCount ?? 1),
      OfficeCloseTime: '18:00',
      PackType: '',
      ProductCode: this.bdProductCode(s),
      ReferenceNo: String(s.awb).slice(0, 20),
      Remarks: String(dto.remarks ?? '').slice(0, 60),
      RouteCode: '',
      ShipmentPickupDate: `/Date(${when.getTime()})/`,
      ShipmentPickupTime: time,
      SubProducts: [''],
      VolumeWeight: weight,
      WeightofShipment: weight,
      isToPayShipper,
    };
    const resp = await this.authed('/pickup/v1/RegisterPickup', { method: 'POST', body: JSON.stringify(this.pickupBody(request, acc)) });
    const result = resp?.RegisterPickupResult ?? resp;
    if (result?.IsError === true || result?.isError === true) {
      throw new BadRequestException(`BlueDart pickup failed: ${this.bdStatusMsg(result) || JSON.stringify(result).slice(0, 300)}`);
    }
    const token = result?.TokenNumber ?? result?.tokenNumber ?? null;
    if (token) await this.prisma.shipment.update({ where: { id: s.id }, data: { bdPickupToken: String(token), bdPickupAt: when } });
    return { awb, token, toPay: isToPayShipper, outstation, pickupDate: when, response: resp };
  }

  /** Register an ad-hoc BlueDart pickup from a PickupRequest (no shipment/AWB). Used by CS to hand a
   *  customer's portal pickup request to BlueDart — returns the pickup token to show the customer.
   *  Outside the account's home area it's registered as an outstation to-pay (FOD) collection. */
  async scheduleAdhocPickup(p: { pincode: string; name: string; phone: string; address1: string; address2?: string; city?: string; pieces?: number; toPay?: boolean; weight?: number; date?: string; remarks?: string; vendor?: string | null; bdAccountId?: bigint | null }) {
    this.ensure();
    // Book under the account the pickup's vendor / chosen account points to (else the default).
    const acc = await this.resolveAccount({ vendor: p.vendor ?? null, bdAccountId: p.bdAccountId ?? null });
    const pin = String(p.pincode ?? '').trim();
    const phone = this.bdMobile(p.phone);
    const name = String(p.name ?? '').slice(0, 30);
    const addr1 = String(p.address1 ?? '').trim();
    const miss: string[] = [];
    if (!pin) miss.push('pickup pincode');
    if (!name) miss.push('contact name');
    if (phone.length < 10) miss.push('contact mobile (10 digits)');
    if (!addr1) miss.push('pickup address');
    if (miss.length) throw new BadRequestException(`Can't hand off the pickup — missing: ${miss.join(', ')}.`);
    const when = p.date ? new Date(p.date) : new Date();
    const time = String(BLUEDART.pickupTime || '1600').replace(/^(\d{2})(\d{2})$/, '$1:$2');
    const home = String(acc.originArea || '').toUpperCase();
    const pickArea = String((await this.areaInfoFor(pin)).area || '').toUpperCase();
    const outstation = !!(home && pickArea && pickArea !== home);
    const isToPayShipper = !!p.toPay || outstation;
    const weight = Number(Number(p.weight ?? 1).toFixed(2));
    const request = {
      AWBNo: [''], AreaCode: acc.originArea, CISDDN: false, ContactPersonName: name,
      CustomerAddress1: addr1.slice(0, 30), CustomerAddress2: String(p.address2 ?? '').slice(0, 30), CustomerAddress3: String(p.city ?? '').slice(0, 30),
      CustomerCode: acc.customerCode, CustomerName: name, CustomerPincode: pin, CustomerTelephoneNumber: phone,
      DoxNDox: '2', EmailID: '', IsForcePickup: false, IsReversePickup: false, MobileTelNo: phone,
      NumberofPieces: Number(p.pieces ?? 1), OfficeCloseTime: '18:00', PackType: '', ProductCode: 'E',
      ReferenceNo: '', Remarks: String(p.remarks ?? 'Portal pickup').slice(0, 60), RouteCode: '',
      ShipmentPickupDate: `/Date(${when.getTime()})/`, ShipmentPickupTime: time, SubProducts: [''],
      VolumeWeight: weight, WeightofShipment: weight, isToPayShipper,
    };
    const resp = await this.authed('/pickup/v1/RegisterPickup', { method: 'POST', body: JSON.stringify(this.pickupBody(request, acc)) });
    const result = resp?.RegisterPickupResult ?? resp;
    if (result?.IsError === true || result?.isError === true) {
      throw new BadRequestException(`BlueDart pickup failed: ${this.bdStatusMsg(result) || JSON.stringify(result).slice(0, 300)}`);
    }
    const token = result?.TokenNumber ?? result?.tokenNumber ?? null;
    return { token: token != null ? String(token) : null, toPay: isToPayShipper, outstation, pickupDate: when, response: resp };
  }

  /** Cancel a BlueDart pickup by its registration token. NOTE: CancelPickup can return HTTP 415
   *  "Access to the method is not allowed" when the APIGEE app isn't subscribed to it — in that
   *  case cancel from the BlueDart portal and ask BlueDart to enable CancelPickup on the app. */
  async cancelPickup(tokenNo: number | string, registrationDate?: string) {
    this.ensure();
    const when = registrationDate ? new Date(registrationDate) : new Date();
    const resp = await this.authed('/pickup/v1/CancelPickup', {
      method: 'POST',
      body: JSON.stringify(this.pickupBody({ TokenNo: Number(tokenNo), PickupRegistrationDate: `/Date(${when.getTime()})/`, Remarks: 'Cancelled from Logimart' })),
    });
    const result = resp?.CancelPickupResponseEntity ?? resp?.CancelPickupResult ?? resp;
    if (result?.IsError === true || result?.isError === true) {
      throw new BadRequestException(`BlueDart cancel pickup failed: ${this.bdStatusMsg(result) || JSON.stringify(result).slice(0, 300)}`);
    }
    return { tokenNo, cancelled: true, response: resp };
  }

  /** Cancel the BlueDart pickup registered on one AWB and clear it from the shipment, so it can be
   *  corrected (e.g. wrong pickup pincode) and handed off again. */
  async cancelShipmentPickup(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, bdPickupToken: true, bdPickupAt: true, bdWaybill: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    if (!s.bdPickupToken) throw new BadRequestException(`${awb} has no BlueDart pickup registered.`);
    const r = await this.cancelPickup(s.bdPickupToken, s.bdPickupAt ? s.bdPickupAt.toISOString() : undefined);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { bdPickupToken: null, bdPickupAt: null, bdDispatchAt: null, bdError: null } });
    return { awb, tokenNo: s.bdPickupToken, cancelled: r.cancelled };
  }

  /** Shipments with a BlueDart pickup registered — powers the "BlueDart pickups" section on the
   *  Pickups page. Newest pickup first. */
  async listPickups(limit = 200) {
    const rows = await this.prisma.shipment.findMany({
      where: { bdPickupToken: { not: null } },
      orderBy: { bdPickupAt: 'desc' },
      take: Math.min(limit, 300),
      select: {
        awb: true, bdPickupToken: true, bdPickupAt: true, bdWaybill: true, bdStatus: true, bdSyncedAt: true,
        shipperPincode: true, destPincode: true, paymentTerm: true, pieceCount: true,
        client: { select: { legalName: true, accountCode: true } },
      },
    });
    return rows.map((s) => ({
      awb: s.awb,
      token: s.bdPickupToken,
      pickupAt: s.bdPickupAt,
      waybill: s.bdWaybill,
      // Pickup stage: SCHEDULED once registered with BlueDart → PICKED once they collect (waybill assigned).
      stage: s.bdWaybill ? 'PICKED' : 'SCHEDULED',
      status: s.bdStatus,
      syncedAt: s.bdSyncedAt,
      origin: s.shipperPincode,
      dest: s.destPincode,
      paymentTerm: s.paymentTerm,
      pieces: s.pieceCount,
      customer: s.client?.legalName ?? null,
      accountCode: s.client?.accountCode ?? null,
    }));
  }

  /** Backfill: sync tracking for ALL BlueDart shipments (any age, including already-delivered),
   *  oldest-synced first, up to `limit`. One-off / admin use — safe to re-run; delivered shipments
   *  just get their final status + scans captured. Throttled to be gentle on the carrier API. */
  async syncAll(limit = 500) {
    this.ensure();
    const rows = await this.prisma.shipment.findMany({
      where: {
        OR: [
          { bdWaybill: { not: null } },
          { AND: [{ forwardingAwb: { not: null } }, { OR: [{ vendor: { startsWith: 'BLUE', mode: 'insensitive' } }, { vendor: { equals: 'BDR', mode: 'insensitive' } }] }] },
          { bdPickupToken: { not: null } },
        ],
      },
      select: { awb: true },
      orderBy: [{ bdSyncedAt: { sort: 'asc', nulls: 'first' } }],
      take: Math.min(Math.max(1, limit), 2000),
    });
    let synced = 0, failed = 0;
    for (const r of rows) {
      try { await this.syncTracking(r.awb); synced++; } catch { failed++; }
      await new Promise((res) => setTimeout(res, 300)); // gentle on the carrier API
    }
    this.logger.log(`BlueDart backfill sync: ${synced}/${rows.length} ok, ${failed} failed.`);
    return { total: rows.length, synced, failed };
  }

  /** Kick off a backfill in the BACKGROUND and return immediately — the backlog can be thousands of
   *  shipments (minutes of throttled carrier calls), too long for a blocking HTTP request. Re-entrant
   *  calls are rejected while one is running. `pending` = BlueDart shipments not yet synced. */
  async startBackfill(limit = 6000) {
    this.ensure();
    const bdWhere = {
      OR: [
        { bdWaybill: { not: null } },
        { AND: [{ forwardingAwb: { not: null } }, { OR: [{ vendor: { startsWith: 'BLUE', mode: 'insensitive' as const } }, { vendor: { equals: 'BDR', mode: 'insensitive' as const } }] }] },
        { bdPickupToken: { not: null } },
      ],
    };
    const [total, pending] = await Promise.all([
      this.prisma.shipment.count({ where: bdWhere }),
      this.prisma.shipment.count({ where: { AND: [bdWhere, { bdSyncedAt: null }] } }),
    ]);
    if (this.backfilling) return { started: false, running: true, total, pending, message: 'A backfill is already running — it drains the whole backlog oldest-first in the background. No need to press again.' };
    this.backfilling = true;
    // Fire-and-forget: drain the ENTIRE unsynced backlog in repeated throttled batches, so one press
    // finishes the job instead of the user re-pressing for each 2000-shipment slice.
    this.drainBackfill(bdWhere)
      .catch((e) => this.logger.warn(`backfill: ${e?.message || e}`))
      .finally(() => { this.backfilling = false; });
    return { started: true, running: true, total, pending, message: `Backfill started — draining all ${pending} unsynced shipment(s) in the background (oldest-first, throttled). This runs to completion on its own; no need to press again.` };
  }

  /** Drain the whole never-synced BlueDart backlog in repeated throttled batches until none remain.
   *  syncAll advances bdSyncedAt (nulls-first), so each pass clears the next slice of unsynced rows. */
  private async drainBackfill(bdWhere: any) {
    let totalDone = 0;
    for (let pass = 0; pass < 50; pass++) {
      const pending = await this.prisma.shipment.count({ where: { AND: [bdWhere, { bdSyncedAt: null }] } });
      if (pending === 0) break;
      const r = await this.syncAll(2000);
      totalDone += r.synced + r.failed;
      if (!r.total) break; // nothing processed — avoid a tight loop
    }
    this.logger.log(`BlueDart backfill drain complete: ~${totalDone} shipment(s) processed.`);
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
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { bdWaybill: true, forwardingAwb: true, bdPickupToken: true, vendor: true, statusCode: true } });
    const waybill = s?.bdWaybill || (s as any)?.forwardingAwb || null;
    let r: any;
    if (waybill) {
      // Known carrier waybill (API hand-off or manually recorded) → track by waybill.
      r = await this.track(waybill, 'awb');
    } else if (s?.bdPickupToken) {
      // Pickup registered but no waybill surfaced yet → discover it by OUR reference (we sent
      // ReferenceNo = our AWB on the pickup). Returns the assigned WaybillNo once BlueDart collects.
      r = await this.track(awb, 'reference');
    } else {
      r = await this.track(awb, 'awb');
    }
    const raw = typeof r?.raw === 'string' ? r.raw : (typeof r === 'string' ? r : JSON.stringify(r));
    // For a pickup-only shipment, capture the waybill BlueDart assigned so later syncs track by it.
    const discovered = !waybill ? ((raw.match(/WaybillNo="([^"]+)"/) || [])[1] || null) : null;
    const { scans, bdStatus, bdStatusDate } = this.parseScans(raw);
    // Electronic POD: BlueDart's tracking names who received a delivered shipment (no POD image in the API).
    const receivedBy = ((raw.match(/<ReceivedBy>([^<]+)<\/ReceivedBy>/) || [])[1] || '').trim() || null;
    // A reference/waybill query with no shipment yet (e.g. a pickup not collected) returns a
    // placeholder like "Incorrect Waybill number or No Information" — don't store it as a real status.
    const noData = scans.length === 0 && /incorrect waybill|no information|not linked|no data/i.test(raw);
    // Persist the carrier status through to our own milestone so every pending-list, dashboard and
    // status-filtered report stays correct — otherwise a BD-forwarded shipment sits at MAN forever
    // and looks "not booked" even after it's delivered.
    const derived = bdStatus && !noData ? deriveStatusFromBd((s as any)?.statusCode, bdStatus) : null;
    await this.prisma.shipment.updateMany({
      where: { awb },
      data: {
        ...(discovered ? { bdWaybill: discovered, forwardingAwb: (s as any)?.forwardingAwb ?? discovered, vendor: (s as any)?.vendor ?? 'BLUEDART' } : {}),
        ...(bdStatus && !noData ? { bdStatus } : {}),
        ...(derived ? { statusCode: derived.statusCode, status: derived.status, statusAt: bdStatusDate ? new Date(bdStatusDate) : new Date() } : {}),
        ...(scans.length ? { bdScans: JSON.stringify(scans) } : {}),
        ...(receivedBy ? { podReceivedBy: receivedBy.slice(0, 120) } : {}),
        bdSyncedAt: new Date(),
      },
    });
    return { awb, bdWaybill: waybill || discovered, discovered, bdStatus: noData ? null : bdStatus, bdStatusDate, scans, tracking: r };
  }

  /**
   * One-time repair: derive statusCode/status from the bdStatus text we ALREADY have on file, for
   * every BD-forwarded shipment still stuck at MAN (or otherwise behind its carrier status). No BlueDart
   * calls — pure local mapping — so it's cheap to re-run. Fixes the historical "delivered shipments still
   * show as pending" backlog without waiting for the next tracking sync.
   */
  async backfillStatusFromBd() {
    const rows = await this.prisma.shipment.findMany({
      where: { bdStatus: { not: null }, statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } },
      select: { id: true, statusCode: true, bdStatus: true, statusAt: true },
    });
    let updated = 0;
    for (const s of rows) {
      const derived = deriveStatusFromBd(s.statusCode, s.bdStatus);
      if (!derived) continue;
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: { statusCode: derived.statusCode, status: derived.status, statusAt: s.statusAt ?? new Date() },
      });
      updated++;
    }
    return { scanned: rows.length, updated };
  }
}
