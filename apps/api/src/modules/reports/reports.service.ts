import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceCacheService } from '../billing/price-cache.service';
import { LaneTat } from '../../common/lane-tat';

type Report = { columns: { key: string; label: string }[]; rows: any[]; note?: string; title?: string };
/** Optional report filters (customer / vendor / status drill-down). */
export type Filters = { clientId?: bigint; vendor?: string; status?: string };

// Status code → plain words (reports show these instead of codes).
const STATUS_LABEL: Record<string, string> = {
  MAN: 'Booked (manifested)', PKD: 'Picked up', ORD: 'In transit (origin)', DPD: 'In transit', DRD: 'Reached destination', OFD: 'Out for delivery',
  DLD: 'Delivered', UDL: 'Undelivered (NDR)', RTO: 'Return to origin', RTD: 'Returned to shipper', CAN: 'Cancelled',
};

// Plain-English transport-mode labels — the raw enum (ROAD_PTL, AIR_EXPRESS…) is internal and
// confuses users, so report exports show the friendly label too (mirrors the web modeLabel).
const MODE_LABEL: Record<string, string> = {
  AIR_EXPRESS: 'Air (Express)', AIR_ECONOMY: 'Air (Economy)',
  ROAD_FTL: 'Surface (Full-load)', ROAD_PTL: 'Surface (Part-load)', RAIL: 'Surface (Rail)',
};
const modeLabel = (m: any) => MODE_LABEL[String(m ?? '').toUpperCase()] ?? (m ?? '—');

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService, private readonly prices: PriceCacheService) {}

  // ---- shared report helpers ----
  private shipWhere(range: any, f: Filters = {}) {
    return { createdAt: range, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.vendor ? { vendor: { equals: f.vendor, mode: 'insensitive' as const } } : {}) };
  }
  private chargeKg(s: any) { return s.chargeWeight != null ? Number(s.chargeWeight) : Math.max(Number(s.totalDeadKg || 0), Number(s.totalVolKg || 0)); }
  private totalRow(rows: any[], labelKey: string, keys: string[]) {
    const t: any = { [labelKey]: 'TOTAL' };
    for (const k of keys) t[k] = rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    return t;
  }
  private fmt(rows: any[], keys: string[]) { return rows.map((r) => { const o = { ...r }; for (const k of keys) if (o[k] !== '' && o[k] != null) o[k] = Number(o[k]).toFixed(2); return o; }); }
  private pendingNote(n: number) { return n > 0 ? `${n.toLocaleString('en-IN')} AWB(s) are still being priced in the background — run the report again in a minute for complete totals.` : ''; }

  /**
   * Data-completeness check — surfaces the master-data gaps that silently break booking/pricing:
   * destination pincodes shipped to that have no zone (→ "no rate"), missing fuel setup (→ no FSC),
   * active customers with no rate card, and active cards priced with 0% fuel. Read-only.
   */
  async dataHealth() {
    const p = this.prisma;

    // 1) Pincodes we've actually shipped TO that lack a zone (→ rate falls back to region → "no rate").
    const dests = await p.shipment.findMany({ where: { destPincode: { not: null } }, select: { destPincode: true }, distinct: ['destPincode'] });
    const destPins = dests.map((d) => d.destPincode as string).filter(Boolean);
    const known = await p.pincode.findMany({ where: { pincode: { in: destPins } }, select: { pincode: true, city: true, state: true, surfaceZone: true, apexZone: true } });
    const kmap = new Map(known.map((k) => [k.pincode, k]));
    const pincodeGaps: { pincode: string; city: string | null; issue: string }[] = [];
    for (const pin of destPins) {
      const k = kmap.get(pin);
      if (!k) { pincodeGaps.push({ pincode: pin, city: null, issue: 'not in the pincode directory' }); continue; }
      const miss = [!k.surfaceZone ? 'surface' : null, !k.apexZone ? 'air' : null].filter(Boolean);
      if (miss.length) pincodeGaps.push({ pincode: pin, city: k.city, issue: `missing ${miss.join(' + ')} zone` });
    }

    // 2) Fuel setup.
    const mechs = await p.masterEntry.findMany({ where: { type: 'FUEL_MECHANISM', active: true }, select: { attrs: true } });
    const airDefaultSet = mechs.some((m) => (m.attrs as any)?.airDefault && Number((m.attrs as any)?.percentage) > 0);
    const dieselMechanismSet = mechs.some((m) => String((m.attrs as any)?.mode ?? 'FLAT').toUpperCase() === 'DYNAMIC' && Number((m.attrs as any)?.percentage ?? (m.attrs as any)?.baseFsc ?? 0) >= 0);

    // 3) Active cards that would price freight with NO fuel (flat 0% and not diesel-indexed).
    //    Grouped by customer and split surface vs air: a SURFACE card at 0% flat truly bills no fuel
    //    line (the real problem); an AIR/EXPRESS card at 0% is covered by the air default when that is
    //    set (green above), so it is flagged separately as lower-priority.
    const cards = await p.customerRateCard.findMany({
      where: { isActive: true },
      select: { fuelPct: true, fuelMode: true, mode: true, product: true, client: { select: { legalName: true, accountCode: true } } },
    });
    const zf = cards.filter((c) => Number(c.fuelPct ?? 0) === 0 && String(c.fuelMode ?? 'FLAT').toUpperCase() !== 'DYNAMIC');
    const zeroFuelActiveCards = zf.length;
    const zfByClient = new Map<string, { code: string; name: string; surface: number; air: number }>();
    for (const c of zf) {
      const code = c.client?.accountCode ?? '—';
      const g = zfByClient.get(code) ?? { code, name: c.client?.legalName ?? '—', surface: 0, air: 0 };
      const isSurface = String(c.mode ?? c.product ?? '').toUpperCase().includes('SURFACE');
      if (isSurface) g.surface += 1; else g.air += 1;
      zfByClient.set(code, g);
    }
    const zfList = [...zfByClient.values()].sort((a, b) => b.surface - a.surface || b.air - a.air || a.name.localeCompare(b.name));
    const zeroFuelSurfaceCards = zf.filter((c) => String(c.mode ?? c.product ?? '').toUpperCase().includes('SURFACE')).length;

    // 4) Active (non-cash) customers with no active rate card → cannot be priced at all.
    const clients = await p.b2bClient.findMany({ where: { isActive: true, isCash: false }, select: { id: true, legalName: true, accountCode: true } });
    const carded = new Set((await p.customerRateCard.findMany({ where: { isActive: true }, select: { clientId: true } })).map((c) => String(c.clientId)));
    const noCard = clients.filter((c) => !carded.has(String(c.id)));

    return {
      pincodeZoneGaps: { count: pincodeGaps.length, sample: pincodeGaps.slice(0, 50) },
      fuel: { airDefaultSet, dieselMechanismSet, zeroFuelActiveCards, zeroFuelSurfaceCards, zeroFuelCustomers: zfList.length, zeroFuelSample: zfList.slice(0, 100) },
      customersWithoutRateCard: { count: noCard.length, sample: noCard.slice(0, 50).map((c) => ({ code: c.accountCode, name: c.legalName })) },
    };
  }

  /**
   * Auto-send the daily NDR + MIS digest every morning. Time is fixed to 08:00 IST (the CronExpression
   * runs in Asia/Kolkata regardless of the server's UTC clock). Skips itself unless recipients are
   * configured (REPORTS_EMAIL / COMPANY_EMAIL) and DIGEST_AUTOSEND isn't set to 'false'.
   */
  @Cron('0 8 * * *', { timeZone: 'Asia/Kolkata' })
  async scheduledDigest() {
    // Replaced by the 9 PM branch / All-India summary (DailySummaryService) — on only if DIGEST_AUTOSEND=true.
    if (String(process.env.DIGEST_AUTOSEND ?? 'false').toLowerCase() !== 'true') return;
    if (!String(process.env.REPORTS_EMAIL || process.env.COMPANY_EMAIL || '').trim()) return;
    try {
      const r = await this.emailDailyDigest();
      this.logger.log(`Morning digest auto-sent → ${r.sent}/${r.sentTo.length} recipient(s).`);
    } catch (e) {
      this.logger.error('Morning digest auto-send failed', e as Error);
    }
  }

  /** Assemble the daily NDR + MIS digest numbers (today's activity + open exceptions/receivables). */
  async dailyDigest() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [booked, delivered, inTransit, ndr, monthInv, receivables] = await Promise.all([
      this.prisma.shipment.count({ where: { createdAt: { gte: start } } }),
      this.prisma.shipment.count({ where: { statusCode: 'DLD', statusAt: { gte: start } } }),
      this.prisma.shipmentPiece.count({ where: { status: { in: ['LOADED', 'IN_TRANSIT'] } } }),
      this.prisma.shipment.count({ where: { statusCode: { in: ['UDL', 'RTO'] } } }),
      this.prisma.invoice.findMany({ where: { issuedAt: { gte: monthStart } }, select: { total: true } }),
      this.prisma.b2bClient.findMany({ select: { outstandingBal: true } }),
    ]);
    const revenueMonth = +monthInv.reduce((s, i) => s + Number(i.total), 0).toFixed(2);
    const outstanding = +receivables.reduce((s, c) => s + Number(c.outstandingBal), 0).toFixed(2);
    const dateStr = new Date().toLocaleDateString('en-GB');
    const summary = { date: dateStr, bookedToday: booked, deliveredToday: delivered, piecesInTransit: inTransit, ndrOpen: ndr, revenueThisMonth: revenueMonth, outstandingReceivables: outstanding };
    const message = [
      `ExcelEx Group daily digest — ${dateStr}`,
      `Booked today: ${booked}`,
      `Delivered today: ${delivered}`,
      `Pieces in transit: ${inTransit}`,
      `NDR / undelivered open: ${ndr}`,
      `Revenue (month): ₹${revenueMonth.toLocaleString('en-IN')}`,
      `Outstanding receivables: ₹${outstanding.toLocaleString('en-IN')}`,
    ].join('\n');
    return { summary, message };
  }

  /** Queue the daily digest as an email to the configured recipients (REPORTS_EMAIL, comma-separated). */
  async emailDailyDigest() {
    const { summary, message } = await this.dailyDigest();
    const recipients = String(process.env.REPORTS_EMAIL || process.env.COMPANY_EMAIL || 'accounts@excelexlog.com').split(',').map((r) => r.trim()).filter(Boolean);
    let sent = 0;
    for (const r of recipients) {
      const rec = await this.notifications.notify({ channel: 'email', recipient: r, kind: 'account', message });
      if (rec.status === 'sent') sent++;
    }
    const note = sent === recipients.length
      ? `Emailed to ${sent} recipient(s).`
      : sent > 0
        ? `Emailed to ${sent}/${recipients.length}; the rest are queued (check the email provider / server logs).`
        : 'Queued — email did not send (provider not configured, or the send failed; check server logs).';
    return { ok: true, sentTo: recipients, sent, summary, message, note };
  }

  async run(type: string, from?: string, to?: string, f: Filters = {}): Promise<Report> {
    // whole IST days
    const gte = from ? new Date(`${from}T00:00:00+05:30`) : new Date(Date.now() - 30 * 86400000);
    const lte = to ? new Date(`${to}T23:59:59.999+05:30`) : new Date();
    const range = { gte, lte };
    switch (type.toUpperCase()) {
      case 'STATUS_AWBS': return this.statusAwbs(range, f);
      case 'AWB_GAPS': return this.awbGaps(range);
      case 'MIS': return this.mis(range);
      case 'DAILY': return this.daily(range);
      case 'CUSTOMER_SUMMARY': return this.customerSummary(range);
      case 'PRODUCT_SUMMARY': return this.productSummary(range, f);
      case 'DESTINATION_SUMMARY': return this.destinationSummary(range);
      case 'DELIVERY_STATUS': return this.deliveryStatus(range, f);
      case 'SCAN': return this.scanReport(range);
      case 'RECEIVABLES': return this.receivables();
      case 'INVOICE': return this.invoiceReport();
      case 'VENDOR': return this.vendorReport(range, f);
      case 'MANIFEST': return this.manifestReport(range);
      case 'PICKUP': return this.pickupReport(range);
      case 'DRS': return this.drsReport(range);
      case 'COMMENT_VIEW': return this.commentView(range);
      case 'INSCAN': return this.inscan(range);
      case 'VOLUMETRIC': return this.volumetric(range);
      case 'VOID': return this.voidReport(range);
      case 'ZERO': return this.zeroReport(range, f);
      case 'LEDGER_AGING': return this.ledgerAging();
      case 'TARIFF': return this.tariff();
      case 'LOCATION_SUMMARY': return this.locationSummary(range);
      case 'NOT_INSCAN': return this.notInscan(range);
      case 'RUNSHEET_NOT_POD': return this.runsheetNotPod(range);
      case 'BILLING': return this.billing(range, f);
      case 'EXTRA_EXPENSE': return this.extraExpense(range, f);
      case 'ACTION_LOG': return this.actionLog(range);
      case 'LOGIN_LOG': return this.loginLog(range);
      case 'MISSING_AWB': return this.missingAwb(range, f);
      case 'CUSTOMER_REGISTER': return this.customerRegister(range);
      case 'SLA': return this.slaSummary(range, f);
      case 'SLA_DETAIL': return this.slaDetail(range, f);
      default: return { columns: [{ key: 'msg', label: 'Info' }], rows: [{ msg: `Report '${type}' is not implemented yet.` }] };
    }
  }

  private async mis(range: any): Promise<Report> {
    const total = await this.prisma.shipment.count({ where: { createdAt: range } });
    const byStatus = await this.prisma.shipment.groupBy({ by: ['status'], where: { createdAt: range }, _count: { _all: true } });
    const m = Object.fromEntries(byStatus.map((x) => [x.status, x._count._all]));
    const rows = [
      { metric: 'Shipments booked', value: total },
      { metric: 'Delivered', value: m['DELIVERED'] || 0 },
      { metric: 'In transit / at hub / OFD', value: (m['IN_TRANSIT'] || 0) + (m['AT_HUB'] || 0) + (m['OUT_FOR_DELIVERY'] || 0) },
      { metric: 'Exceptions', value: m['EXCEPTION'] || 0 },
      { metric: 'Created (not yet moved)', value: m['CREATED'] || 0 },
    ];
    return { columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }], rows };
  }

  /** Extra Expense report action (#13-2): Billed (by hand, kept off invoices) / Rejected by customer / undo. */
  async extraExpenseAction(id: string, action: string, ref?: string, userId?: bigint) {
    const a = await this.prisma.shipmentAddon.findUnique({ where: { id: BigInt(id) } });
    if (!a) throw new NotFoundException('Expense not found');
    if (a.billedInvoiceId) throw new BadRequestException('Already billed on an invoice — change it on the invoice.');
    const data: any =
      action === 'billed' ? { markedBilledAt: new Date(), markedBilledRef: (ref || '').trim().slice(0, 60) || null, toBill: true, noBillReason: null }
      : action === 'rejected' ? { toBill: false, noBillReason: 'Rejected by customer', markedBilledAt: null, markedBilledRef: null }
      : action === 'reset' ? { toBill: true, noBillReason: null, markedBilledAt: null, markedBilledRef: null }
      : null;
    if (!data) throw new BadRequestException('Action must be billed, rejected or reset.');
    await this.prisma.shipmentAddon.update({ where: { id: a.id }, data: { ...data, actionById: userId ?? null } });
    return { ok: true };
  }

  /** AWB-wise extra expenses with their billing status — billed (invoice no), to be billed, or not to be
   *  billed (with the reason) — and a summary of each. */
  private async extraExpense(range: any, f: Filters = {}): Promise<Report> {
    const rows: any[] = await this.prisma.shipmentAddon.findMany({
      where: { createdAt: range, ...(f.clientId ? { shipment: { clientId: f.clientId } } : {}) },
      include: { shipment: { select: { awb: true, client: { select: { legalName: true, accountCode: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 5000,
    });
    const invIds = [...new Set(rows.map((r) => r.billedInvoiceId).filter(Boolean))];
    const invNo = new Map((invIds.length ? await this.prisma.invoice.findMany({ where: { id: { in: invIds } }, select: { id: true, invoiceNo: true } }) : []).map((i) => [i.id.toString(), i.invoiceNo]));
    const sum = { billed: 0, toBill: 0, notBilled: 0 };
    const reasons = new Map<string, number>();
    const out: any[] = rows.map((r) => {
      const amt = Number(r.amount) || 0;
      let status: string;
      if (r.billedInvoiceId) { status = `Billed — ${invNo.get(r.billedInvoiceId.toString()) ?? 'invoice'}`; sum.billed += amt; }
      else if (r.markedBilledAt) { status = `Billed — marked${r.markedBilledRef ? ` (${r.markedBilledRef})` : ''}`; sum.billed += amt; }
      else if (r.toBill) { status = 'To be billed (next invoice)'; sum.toBill += amt; }
      else { const why = r.noBillReason || 'no reason given'; status = `Not to be billed — ${why}`; sum.notBilled += amt; reasons.set(why, (reasons.get(why) ?? 0) + amt); }
      return {
        date: new Date(+r.createdAt + 330 * 60000).toISOString().slice(0, 10), awb: r.shipment?.awb ?? '—', customer: r.shipment?.client?.legalName ?? '—',
        reason: r.reason ?? '', serviceCentre: r.serviceCentre ?? '', route: [r.fromLoc, r.toLoc].filter(Boolean).join(' → '), mode: r.mode ?? '',
        amount: amt.toFixed(2), status,
        // Action buttons (Billed / Rejected by customer): on anything not yet on an invoice; Undo on a manual mark.
        _addonId: String(r.id), _can: r.billedInvoiceId ? 'none' : r.markedBilledAt || (!r.toBill && r.noBillReason === 'Rejected by customer') ? 'undo' : 'act',
      };
    });
    const total = sum.billed + sum.toBill + sum.notBilled;
    const s = (label: string, v: number) => ({ date: '', awb: '', customer: '', reason: '', serviceCentre: '', route: '', mode: label, amount: v.toFixed(2), status: '', _summary: true });
    out.push(s('SUMMARY — Billed', sum.billed), s('To be billed', sum.toBill), s('Not to be billed', sum.notBilled));
    for (const [why, v] of reasons) out.push({ ...s(`   · ${why}`, v) });
    out.push(s('TOTAL', total));
    return {
      columns: [
        { key: 'date', label: 'Date' }, { key: 'awb', label: 'AWB' }, { key: 'customer', label: 'Customer' },
        { key: 'reason', label: 'Expense' }, { key: 'serviceCentre', label: 'Service centre' },
        { key: 'route', label: 'From → To' }, { key: 'mode', label: 'Paid by' },
        { key: 'amount', label: 'Amount ₹' }, { key: 'status', label: 'Billing' }, { key: '_action', label: 'Action' },
      ],
      rows: out,
    };
  }

  private async daily(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range }, select: { createdAt: true, totalDeadKg: true } });
    const m = new Map<string, { count: number; kg: number }>();
    for (const x of s) {
      const d = x.createdAt.toISOString().slice(0, 10);
      const e = m.get(d) || { count: 0, kg: 0 };
      e.count++; e.kg += Number(x.totalDeadKg);
      m.set(d, e);
    }
    const rows = [...m.entries()].sort().map(([date, v]) => ({ date, shipments: v.count, deadKg: v.kg.toFixed(2) }));
    return { columns: [{ key: 'date', label: 'Date' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async customerSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['clientId'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const clients = await this.prisma.b2bClient.findMany({ select: { id: true, legalName: true } });
    const nm = new Map(clients.map((c) => [c.id.toString(), c.legalName]));
    const rows = g
      .map((x) => ({ customer: nm.get(x.clientId.toString()) || x.clientId.toString(), shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'customer', label: 'Customer' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  /** Product-wise volume + sales (pre-GST: the invoice line once billed, else the rate card). */
  private async productSummary(range: any, f: Filters = {}): Promise<Report> {
    const ships = await this.prisma.shipment.findMany({ where: this.shipWhere(range, f), select: { id: true, product: true, totalDeadKg: true, totalVolKg: true, chargeWeight: true, statusCode: true } });
    const { prices, pending } = await this.prices.ensure(ships.map((s) => s.id));
    const m = new Map<string, any>();
    for (const s of ships) {
      const k = s.product || '—';
      const r = m.get(k) ?? { product: k, shipments: 0, deadKg: 0, chargeKg: 0, sales: 0 };
      r.shipments++; r.deadKg += Number(s.totalDeadKg || 0); r.chargeKg += this.chargeKg(s);
      if (s.statusCode !== 'CAN') r.sales += prices.get(s.id.toString())?.subtotal ?? 0;
      m.set(k, r);
    }
    const rows = [...m.values()].sort((a, b) => b.shipments - a.shipments);
    rows.push(this.totalRow(rows, 'product', ['shipments', 'deadKg', 'chargeKg', 'sales']));
    return {
      columns: [{ key: 'product', label: 'Product' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }, { key: 'chargeKg', label: 'Charge kg' }, { key: 'sales', label: 'Sales ₹ (excl. GST)' }],
      rows: this.fmt(rows, ['deadKg', 'chargeKg', 'sales']), note: this.pendingNote(pending),
    };
  }

  private async destinationSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['destZone'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const rows = g
      .map((x) => ({ destination: x.destZone || '—', shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'destination', label: 'Destination zone' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  /** Status-wise count; each row opens the AWB list for that status. */
  private async deliveryStatus(range: any, f: Filters = {}): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['statusCode'], where: this.shipWhere(range, f), _count: { _all: true } });
    const rows = g.map((x) => ({ status: STATUS_LABEL[String(x.statusCode || 'MAN')] ?? x.statusCode, count: x._count._all, _drill: { type: 'STATUS_AWBS', status: x.statusCode || 'MAN' } }))
      .sort((a, b) => b.count - a.count);
    rows.push({ status: 'TOTAL', count: rows.reduce((t, r) => t + r.count, 0), _drill: undefined as any });
    return { columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'AWBs' }], rows, note: 'Click a status to see its AWBs.' };
  }

  /** AWBs in one status (drill-down from Delivery Status). */
  private async statusAwbs(range: any, f: Filters = {}): Promise<Report> {
    const st = String(f.status || 'MAN').toUpperCase();
    const s = await this.prisma.shipment.findMany({
      where: { ...this.shipWhere(range, f), ...(st === 'MAN' ? { OR: [{ statusCode: 'MAN' }, { statusCode: null }] } : { statusCode: st }) },
      select: { awb: true, createdAt: true, statusAt: true, product: true, vendor: true, forwardingAwb: true, consigneeName: true, consigneeCity: true, destPincode: true, bdStatus: true, client: { select: { accountCode: true, legalName: true } } },
      orderBy: { createdAt: 'asc' }, take: 5000,
    });
    const d = (v: any) => (v ? new Date(+new Date(v) + 330 * 60000).toISOString().slice(0, 10) : '—');
    const rows = s.map((x) => ({
      awb: x.awb, booked: d(x.createdAt), customer: `${x.client?.accountCode ?? ''} ${x.client?.legalName ?? ''}`.trim(), product: x.product || '—', vendor: x.vendor || '—',
      forwarding: x.forwardingAwb || '—', consignee: x.consigneeName || '—', destination: [x.consigneeCity, x.destPincode].filter(Boolean).join(' ') || '—',
      carrierStatus: x.bdStatus || '—', since: d(x.statusAt),
    }));
    return {
      title: `${STATUS_LABEL[st] ?? st} — AWBs`,
      columns: [{ key: 'awb', label: 'AWB' }, { key: 'booked', label: 'Booked' }, { key: 'customer', label: 'Customer' }, { key: 'product', label: 'Product' }, { key: 'vendor', label: 'Vendor' }, { key: 'forwarding', label: 'Forwarding no' }, { key: 'consignee', label: 'Consignee' }, { key: 'destination', label: 'Destination' }, { key: 'carrierStatus', label: 'Carrier status' }, { key: 'since', label: 'Status date' }],
      rows,
    };
  }

  private async scanReport(range: any): Promise<Report> {
    const s = await this.prisma.scanLog.findMany({ where: { scanAt: range }, orderBy: { scanAt: 'desc' }, take: 1000 });
    const rows = s.map((x) => ({ awb: x.awb, event: x.eventType, serviceCenter: x.serviceCenter || '—', at: x.scanAt.toISOString().replace('T', ' ').slice(0, 19) }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'event', label: 'Event' }, { key: 'serviceCenter', label: 'Service centre' }, { key: 'at', label: 'At' }], rows };
  }

  private async invoiceReport(): Promise<Report> {
    const inv = await this.prisma.invoice.findMany({
      include: { client: { select: { legalName: true } } },
      orderBy: { id: 'desc' },
      take: 500,
    });
    const rows = inv.map((x) => ({ invoiceNo: x.invoiceNo, customer: x.client.legalName, total: Number(x.total).toFixed(2), status: x.status, dueDate: x.dueDate.toISOString().slice(0, 10) }));
    return { columns: [{ key: 'invoiceNo', label: 'Invoice No' }, { key: 'customer', label: 'Customer' }, { key: 'total', label: 'Total ₹' }, { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due date' }], rows };
  }

  /** Vendor × product: volume, weight, our sales and the vendor amount, for the date range. */
  private async vendorReport(range: any, f: Filters = {}): Promise<Report> {
    const ships = await this.prisma.shipment.findMany({ where: { ...this.shipWhere(range, f), NOT: { statusCode: 'CAN' } }, select: { id: true, vendor: true, product: true, totalDeadKg: true, totalVolKg: true, chargeWeight: true } });
    const { prices, pending } = await this.prices.ensure(ships.map((s) => s.id));
    const names = new Map((await this.prisma.vendor.findMany({ select: { vendorCode: true, name: true } })).map((v) => [String(v.vendorCode).toUpperCase(), v.name]));
    const m = new Map<string, any>();
    for (const s of ships) {
      const v = String(s.vendor || '—').toUpperCase();
      const k = `${v}|${s.product || '—'}`;
      const r = m.get(k) ?? { vendor: v, vendorName: names.get(v) ?? '', product: s.product || '—', shipments: 0, deadKg: 0, chargeKg: 0, sales: 0, vendorAmount: 0, vendorPriced: 0 };
      const p = prices.get(s.id.toString());
      r.shipments++; r.deadKg += Number(s.totalDeadKg || 0); r.chargeKg += this.chargeKg(s); r.sales += p?.subtotal ?? 0;
      if (p?.vendorCost != null) { r.vendorAmount += p.vendorCost; r.vendorPriced++; }
      m.set(k, r);
    }
    const rows = [...m.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || b.shipments - a.shipments)
      .map((r) => ({ ...r, vendorPriced: `${r.vendorPriced}/${r.shipments}` }));
    rows.push({ ...this.totalRow(rows, 'vendor', ['shipments', 'deadKg', 'chargeKg', 'sales', 'vendorAmount']), vendorName: '', product: '', vendorPriced: '' });
    return {
      columns: [{ key: 'vendor', label: 'Vendor' }, { key: 'vendorName', label: 'Name' }, { key: 'product', label: 'Product' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }, { key: 'chargeKg', label: 'Charge kg' }, { key: 'sales', label: 'Sales ₹ (excl. GST)' }, { key: 'vendorAmount', label: 'Vendor amount ₹' }, { key: 'vendorPriced', label: 'Vendor-priced AWBs' }],
      rows: this.fmt(rows, ['deadKg', 'chargeKg', 'sales', 'vendorAmount']),
      note: [this.pendingNote(pending), 'Vendor amount = the uploaded vendor bill, else the vendor\'s rate card in the system; AWBs with neither are not counted (see "Vendor-priced AWBs").'].filter(Boolean).join(' '),
    };
  }

  private async manifestReport(range: any): Promise<Report> {
    const m = await this.prisma.manifest.findMany({ where: { createdAt: range }, orderBy: { id: 'desc' }, take: 500 });
    const rows = m.map((x) => ({ code: x.code, vehicleNo: x.vehicleNo, status: x.status, at: x.createdAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'code', label: 'Manifest' }, { key: 'vehicleNo', label: 'Vehicle' }, { key: 'status', label: 'Status' }, { key: 'at', label: 'Created' }], rows };
  }

  private async pickupReport(range: any): Promise<Report> {
    const p = await this.prisma.pickupRequest.findMany({ where: { createdAt: range }, orderBy: { id: 'desc' }, take: 500 });
    const rows = p.map((x) => ({ address: x.pickupAddress, city: x.city || '—', pieces: x.estPieces, mode: x.cargoMode || '—', at: x.createdAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'address', label: 'Pickup address' }, { key: 'city', label: 'City' }, { key: 'pieces', label: 'Est. pieces' }, { key: 'mode', label: 'Mode' }, { key: 'at', label: 'Created' }], rows };
  }

  private async drsReport(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({
      where: { createdAt: range, deliveryRiderId: { not: null } },
      select: { awb: true, status: true, deliveryRiderId: true, destZone: true, consigneeName: true, pieceCount: true },
      orderBy: { id: 'desc' }, take: 1000,
    });
    const rows = s.map((x) => ({ awb: x.awb, rider: x.deliveryRiderId?.toString() ?? '—', consignee: x.consigneeName || '—', destination: x.destZone, pieces: x.pieceCount, status: x.status }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'rider', label: 'Field exec' }, { key: 'consignee', label: 'Consignee' }, { key: 'destination', label: 'Destination' }, { key: 'pieces', label: 'Pcs' }, { key: 'status', label: 'Status' }], rows };
  }

  private async commentView(range: any): Promise<Report> {
    const s = await this.prisma.scanLog.findMany({ where: { scanAt: range, eventType: 'COMMENT' }, orderBy: { scanAt: 'desc' }, take: 1000 });
    const rows = s.map((x) => ({ awb: x.awb, comment: x.remark || '—', at: x.scanAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'comment', label: 'Comment' }, { key: 'at', label: 'At' }], rows };
  }

  private async inscan(range: any): Promise<Report> {
    const s = await this.prisma.scanLog.findMany({ where: { scanAt: range, eventType: { in: ['PICKUP_IN', 'MANIFEST_IN'] } }, orderBy: { scanAt: 'desc' }, take: 1000 });
    const rows = s.map((x) => ({ awb: x.awb, event: x.eventType, serviceCenter: x.serviceCenter || '—', at: x.scanAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'event', label: 'Event' }, { key: 'serviceCenter', label: 'Service centre' }, { key: 'at', label: 'At' }], rows };
  }

  private async volumetric(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range }, select: { awb: true, totalDeadKg: true, totalVolKg: true, chargeWeight: true }, orderBy: { id: 'desc' }, take: 1000 });
    const rows = s.map((x) => ({ awb: x.awb, deadKg: Number(x.totalDeadKg).toFixed(2), volKg: Number(x.totalVolKg).toFixed(2), chargeKg: x.chargeWeight != null ? Number(x.chargeWeight).toFixed(2) : '—' }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'deadKg', label: 'Dead kg' }, { key: 'volKg', label: 'Vol kg' }, { key: 'chargeKg', label: 'Charge kg' }], rows };
  }

  /** Voided / cancelled AWBs — cancelled OR booked in the range (an AWB booked last month and voided now counts). */
  private async voidReport(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({
      where: { statusCode: 'CAN', OR: [{ statusAt: range }, { createdAt: range }] },
      select: { awb: true, consigneeName: true, createdAt: true, statusAt: true, exceptionFlag: true, client: { select: { accountCode: true, legalName: true } } },
      orderBy: { statusAt: 'desc' }, take: 2000,
    });
    const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '—');
    const rows = s.map((x) => ({ awb: x.awb, customer: `${x.client?.accountCode ?? ''} ${x.client?.legalName ?? ''}`.trim(), consignee: x.consigneeName || '—', booked: d(x.createdAt), voided: d(x.statusAt), reason: x.exceptionFlag || '—' }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'customer', label: 'Customer' }, { key: 'consignee', label: 'Consignee' }, { key: 'booked', label: 'Booked' }, { key: 'voided', label: 'Voided' }, { key: 'reason', label: 'Reason' }], rows };
  }

  /** AWBs whose FREIGHT is ₹0 (freight only — not fuel / other / total): missing rate card, weight or zone. */
  private async zeroReport(range: any, f: Filters = {}): Promise<Report> {
    const ships = await this.prisma.shipment.findMany({
      where: { ...this.shipWhere(range, f), NOT: { statusCode: 'CAN' } },
      select: { id: true, awb: true, createdAt: true, product: true, vendor: true, destPincode: true, destZone: true, totalDeadKg: true, totalVolKg: true, chargeWeight: true, client: { select: { accountCode: true, legalName: true } } },
    });
    const { prices, pending } = await this.prices.ensure(ships.map((s) => s.id));
    const rows = ships.filter((s) => (prices.get(s.id.toString())?.freight ?? 0) <= 0 && prices.has(s.id.toString())).map((s) => {
      const p = prices.get(s.id.toString())!;
      return {
        awb: s.awb, booked: new Date(+s.createdAt + 330 * 60000).toISOString().slice(0, 10), customer: `${s.client?.accountCode ?? ''} ${s.client?.legalName ?? ''}`.trim(),
        product: s.product || '—', vendor: s.vendor || '—', destination: [s.destPincode, s.destZone].filter(Boolean).join(' / ') || '—',
        chargeKg: this.chargeKg(s).toFixed(2), freight: '0.00',
        why: p.basis === 'INVOICE' ? 'Billed at ₹0 freight' : this.chargeKg(s) <= 0 ? 'No weight' : !s.destZone ? 'No destination zone' : 'No rate card / lane for this customer × product',
      };
    });
    return {
      columns: [{ key: 'awb', label: 'AWB' }, { key: 'booked', label: 'Booked' }, { key: 'customer', label: 'Customer' }, { key: 'product', label: 'Product' }, { key: 'vendor', label: 'Vendor' }, { key: 'destination', label: 'Destination (pin / zone)' }, { key: 'chargeKg', label: 'Charge kg' }, { key: 'freight', label: 'Freight ₹' }, { key: 'why', label: 'Likely reason' }],
      rows, note: this.pendingNote(pending),
    };
  }

  private async ledgerAging(): Promise<Report> {
    const inv = await this.prisma.invoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } as any }, include: { client: { select: { legalName: true } } }, take: 1000 });
    const now = Date.now();
    const rows = inv.map((x) => {
      const days = Math.floor((now - x.dueDate.getTime()) / 86400000);
      const bucket = days <= 0 ? 'Current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      return { invoiceNo: x.invoiceNo, customer: x.client.legalName, total: Number(x.total).toFixed(2), dueDate: x.dueDate.toISOString().slice(0, 10), daysOverdue: Math.max(0, days), bucket };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);
    return { columns: [{ key: 'invoiceNo', label: 'Invoice' }, { key: 'customer', label: 'Customer' }, { key: 'total', label: 'Total ₹' }, { key: 'dueDate', label: 'Due date' }, { key: 'daysOverdue', label: 'Days overdue' }, { key: 'bucket', label: 'Bucket' }], rows };
  }

  /**
   * SLA classification against the CARRIER'S STANDARD transit for the lane (ZONE_TAT), not the stored EDD —
   * imported shipments carry ~3-week EDDs that made everything look on time. Measured only when the
   * delivered date is real (BlueDart scan dates, or booked / handed off through the ERP); appointment
   * deliveries are excluded; lanes without a standard can't be measured.
   */
  private async slaRows(range: any, f: Filters = {}) {
    const ships = await this.prisma.shipment.findMany({
      where: { statusCode: 'DLD', statusAt: range, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.vendor ? { vendor: { equals: f.vendor, mode: 'insensitive' as const } } : {}) },
      select: { awb: true, clientId: true, vendor: true, product: true, consigneeCity: true, destZone: true, serviceMode: true, createdAt: true, statusAt: true, apptDelivery: true, shipperPincode: true, destPincode: true, bdHandedAt: true },
    });
    const tat = new LaneTat(this.prisma);
    const zones = await tat.pinZones(ships.flatMap((s) => [s.shipperPincode, s.destPincode]));
    const out: { s: any; key: string; cls: 'ONTIME' | 'DELAYED' | 'EXCLUDED' | 'NO_STANDARD' | 'UNTRACKED'; std: number | null; days: number | null; late: number }[] = [];
    for (const s of ships) {
      const key = await tat.carrierKey(s.vendor);
      const surface = LaneTat.isSurfaceProduct(s.product) || /ROAD|RAIL|SURFACE/i.test(String(s.serviceMode ?? ''));
      const std = await tat.standardTat(key, surface ? 'SURFACE' : 'APEX', LaneTat.zone(zones.get(String(s.shipperPincode)), surface), LaneTat.zone(zones.get(String(s.destPincode)), surface));
      const days = s.statusAt ? LaneTat.days(s.createdAt, s.statusAt) : null;
      let cls: (typeof out)[number]['cls'];
      if (s.apptDelivery) cls = 'EXCLUDED';
      else if (!LaneTat.measurable(key, s) || days == null || days < 0) cls = 'UNTRACKED';
      else if (!std) cls = 'NO_STANDARD';
      else cls = days <= std ? 'ONTIME' : 'DELAYED';
      out.push({ s, key, cls, std, days, late: cls === 'DELAYED' ? (days as number) - (std as number) : 0 });
    }
    return out;
  }

  /** On-time vs delay — overall, then carrier × product. */
  private async slaSummary(range: any, f: Filters = {}): Promise<Report> {
    const rows = await this.slaRows(range, f);
    const blank = () => ({ delivered: 0, ontime: 0, delayed: 0, delaySum: 0, excluded: 0, untracked: 0, noStd: 0 });
    const all = blank();
    const by = new Map<string, any>();
    for (const r of rows) {
      const k = `${r.key}|${r.s.product || '—'}`;
      const g = by.get(k) ?? { vendor: r.key === 'BDR' ? 'BlueDart (all accounts)' : r.key, product: r.s.product || '—', ...blank() };
      for (const t of [all, g]) {
        t.delivered++;
        if (r.cls === 'ONTIME') t.ontime++;
        else if (r.cls === 'DELAYED') { t.delayed++; t.delaySum += r.late; }
        else if (r.cls === 'EXCLUDED') t.excluded++;
        else if (r.cls === 'UNTRACKED') t.untracked++;
        else t.noStd++;
      }
      by.set(k, g);
    }
    const line = (label: string, t: any, vendor = '', product = '') => {
      const measured = t.ontime + t.delayed;
      return { group: label, vendor, product, delivered: t.delivered, measured, ontime: t.ontime, delayed: t.delayed, ontimePct: measured ? `${((t.ontime / measured) * 100).toFixed(1)}%` : '—', avgDelay: t.delayed ? (t.delaySum / t.delayed).toFixed(1) : '0', notMeasured: t.excluded + t.untracked + t.noStd };
    };
    const rowsOut = [line('ALL', all), ...[...by.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || b.delivered - a.delivered).map((g) => line('', g, g.vendor, g.product))];
    return {
      columns: [{ key: 'group', label: '' }, { key: 'vendor', label: 'Carrier' }, { key: 'product', label: 'Product' }, { key: 'delivered', label: 'Delivered' }, { key: 'measured', label: 'Measured' }, { key: 'ontime', label: 'On-time' }, { key: 'delayed', label: 'Delayed' }, { key: 'ontimePct', label: 'On-time %' }, { key: 'avgDelay', label: 'Avg delay (days)' }, { key: 'notMeasured', label: 'Not measured' }],
      rows: rowsOut,
      note: `On time = delivered within the carrier's standard transit days for the lane (zone transit tables). Measured: BlueDart (its own scan dates) and shipments booked / handed off through the ERP. Not measured: ${all.untracked} bulk-imported with no reliable delivered date, ${all.noStd} lanes without a standard, ${all.excluded} appointment deliveries.`,
    };
  }

  /** Per-AWB SLA detail — standard vs actual days and the result, worst delays first. */
  private async slaDetail(range: any, f: Filters = {}): Promise<Report> {
    const rows = await this.slaRows(range, f);
    const clients = await this.prisma.b2bClient.findMany({ select: { id: true, legalName: true } });
    const nm = new Map(clients.map((c) => [c.id.toString(), c.legalName]));
    const d10 = (v: any) => (v ? new Date(+new Date(v) + 330 * 60000).toISOString().slice(0, 10).split('-').reverse().join('/') : '—');
    const label: Record<string, string> = { ONTIME: '✅ On-time', DELAYED: '🔴 Delayed', EXCLUDED: '⏸ Appointment', NO_STANDARD: '— no standard for lane', UNTRACKED: '— not measured (imported)' };
    const out = rows.map((r) => ({
      awb: r.s.awb,
      customer: nm.get(r.s.clientId.toString()) || r.s.clientId.toString(),
      vendor: r.s.vendor || '—', product: r.s.product || '—',
      dest: r.s.consigneeCity || r.s.destZone || '—',
      mode: modeLabel(r.s.serviceMode),
      booked: d10(r.s.createdAt),
      dueBy: r.std ? d10(+new Date(r.s.createdAt) + r.std * 864e5) : '—',
      delivered: d10(r.s.statusAt),
      standard: r.std ?? '—', actual: r.days ?? '—',
      daysLate: r.late,
      result: r.cls === 'DELAYED' ? `${label[r.cls]} (${r.late}d)` : label[r.cls],
      _sort: r.cls === 'DELAYED' ? r.late : r.cls === 'ONTIME' ? -1 : -2,
    })).sort((a, b) => b._sort - a._sort).map(({ _sort, ...x }) => x);
    return { columns: [
      { key: 'awb', label: 'AWB' }, { key: 'customer', label: 'Customer' }, { key: 'vendor', label: 'Vendor' }, { key: 'product', label: 'Product' }, { key: 'dest', label: 'Destination' },
      { key: 'mode', label: 'Mode' }, { key: 'booked', label: 'Booked' }, { key: 'standard', label: 'Standard days' }, { key: 'dueBy', label: 'Due by' },
      { key: 'delivered', label: 'Delivered' }, { key: 'actual', label: 'Actual days' }, { key: 'daysLate', label: 'Days late' }, { key: 'result', label: 'Result' },
    ], rows: out };
  }

  private async tariff(): Promise<Report> {
    const rc = await this.prisma.rateCard.findMany({ include: { client: { select: { legalName: true } } }, orderBy: { id: 'desc' }, take: 1000 });
    const rows = rc.map((x) => ({ customer: x.client?.legalName ?? '—', lane: `${x.originZone} → ${x.destZone}`, mode: modeLabel(x.serviceMode), perKg: Number(x.perKgRate).toFixed(2), minCharge: Number(x.minCharge).toFixed(2), fuelPct: Number(x.fuelPct).toFixed(2) }));
    return { columns: [{ key: 'customer', label: 'Customer' }, { key: 'lane', label: 'Lane' }, { key: 'mode', label: 'Mode' }, { key: 'perKg', label: 'Per-kg ₹' }, { key: 'minCharge', label: 'Min ₹' }, { key: 'fuelPct', label: 'Fuel %' }], rows };
  }

  private async locationSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['originHubId'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const hubs = await this.prisma.hub.findMany({ select: { id: true, name: true, code: true } });
    const nm = new Map(hubs.map((h) => [h.id.toString(), `${h.code} — ${h.name}`]));
    const rows = g
      .map((x) => ({ location: (x.originHubId != null && (nm.get(x.originHubId.toString()) || x.originHubId.toString())) || 'Direct (no hub)', shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'location', label: 'Origin location' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async notInscan(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range }, select: { awb: true, status: true, consigneeName: true }, orderBy: { id: 'desc' }, take: 2000 });
    const scanned = await this.prisma.scanLog.findMany({ where: { eventType: 'PICKUP_IN' }, select: { awb: true } });
    const set = new Set(scanned.map((x) => x.awb));
    const rows = s.filter((x) => !set.has(x.awb)).slice(0, 1000).map((x) => ({ awb: x.awb, consignee: x.consigneeName || '—', status: x.status }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'consignee', label: 'Consignee' }, { key: 'status', label: 'Status' }], rows };
  }

  private async runsheetNotPod(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range, deliveryRiderId: { not: null } }, select: { awb: true, deliveryRiderId: true, status: true, pods: { select: { id: true } } }, take: 2000 });
    const rows = s.filter((x) => x.pods.length === 0).map((x) => ({ awb: x.awb, rider: x.deliveryRiderId?.toString() ?? '—', status: x.status }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'rider', label: 'Field exec' }, { key: 'status', label: 'Status' }], rows };
  }

  /** AWB-wise billing — every shipment booked in the range with freight / fuel / other / total (pre-GST):
   *  the invoice line once billed, otherwise the rate-card estimate (marked "Estimate"). */
  private async billing(range: any, f: Filters = {}): Promise<Report> {
    const s = await this.prisma.shipment.findMany({
      where: { ...this.shipWhere(range, f), OR: [{ statusCode: null }, { statusCode: { not: 'CAN' } }] },
      select: {
        id: true, awb: true, createdAt: true, product: true, vendor: true, chargeWeight: true, totalDeadKg: true, totalVolKg: true, statusCode: true,
        client: { select: { accountCode: true, legalName: true } },
        invoiceLines: { select: { chargeableKg: true, invoice: { select: { invoiceNo: true } } }, take: 1 },
      },
      orderBy: { createdAt: 'asc' }, take: 20000,
    });
    const { prices, pending } = await this.prices.ensure(s.map((x) => x.id));
    const f2 = (v: any) => Number(v || 0).toFixed(2);
    const rows = s.map((x) => {
      const l: any = x.invoiceLines[0];
      const p = prices.get(x.id.toString());
      return {
        date: new Date(+x.createdAt + 330 * 60000).toISOString().slice(0, 10), awb: x.awb, customer: `${x.client?.accountCode ?? ''} ${x.client?.legalName ?? ''}`.trim(),
        product: x.product || '—', vendor: x.vendor || '—', status: x.statusCode || 'MAN',
        chargeKg: l ? Number(l.chargeableKg).toFixed(2) : this.chargeKg(x).toFixed(2),
        freight: p ? f2(p.freight) : '', fuel: p ? f2(p.fuel) : '', other: p ? f2(p.other) : '', total: p ? f2(p.subtotal) : '',
        invoiceNo: l?.invoice?.invoiceNo ?? (p?.basis === 'NONE' ? 'Unbilled — no rate' : 'Unbilled — estimate'),
      };
    });
    const tot = (k: string) => rows.reduce((t, r: any) => t + Number(r[k] || 0), 0).toFixed(2);
    rows.push({ date: '', awb: 'TOTAL', customer: `${rows.length} AWBs`, product: '', vendor: '', status: '', chargeKg: tot('chargeKg'), freight: tot('freight'), fuel: tot('fuel'), other: tot('other'), total: tot('total'), invoiceNo: '' });
    return {
      columns: [{ key: 'date', label: 'Booked' }, { key: 'awb', label: 'AWB' }, { key: 'customer', label: 'Customer' }, { key: 'product', label: 'Product' }, { key: 'vendor', label: 'Vendor' }, { key: 'status', label: 'Status' }, { key: 'chargeKg', label: 'Charge kg' }, { key: 'freight', label: 'Freight ₹' }, { key: 'fuel', label: 'Fuel ₹' }, { key: 'other', label: 'Other ₹' }, { key: 'total', label: 'Total ₹ (pre-GST)' }, { key: 'invoiceNo', label: 'Invoice' }],
      rows, note: this.pendingNote(pending),
    };
  }

  private async actionLog(range: any): Promise<Report> {
    const a = await this.prisma.auditLog.findMany({ where: { createdAt: range }, orderBy: { id: 'desc' }, take: 500 });
    const rows = a.map((x) => ({ user: x.userName || x.userId?.toString() || '—', action: x.action, entity: x.entity || '—', method: x.method, status: x.status, at: x.createdAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'user', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Entity' }, { key: 'method', label: 'Method' }, { key: 'status', label: 'HTTP' }, { key: 'at', label: 'At' }], rows };
  }

  private async loginLog(range: any): Promise<Report> {
    const a = await this.prisma.auditLog.findMany({ where: { createdAt: range, path: { contains: 'auth/login' } }, orderBy: { id: 'desc' }, take: 500 });
    const rows = a.map((x) => ({ user: x.userName || x.userId?.toString() || '—', status: x.status, ip: x.ip || '—', at: x.createdAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'user', label: 'User' }, { key: 'status', label: 'HTTP' }, { key: 'ip', label: 'IP' }, { key: 'at', label: 'At' }], rows };
  }

  /** AWBs still without a forwarding (carrier) number — with the vendor they were assigned at pickup. */
  private async missingAwb(range: any, f: Filters = {}): Promise<Report> {
    const s = await this.prisma.shipment.findMany({
      where: { ...this.shipWhere(range, f), forwardingAwb: null, bdWaybill: null, NOT: [{ statusCode: 'CAN' }, { vendor: 'LOGM' }] },
      select: { awb: true, createdAt: true, vendor: true, product: true, statusCode: true, consigneeName: true, destPincode: true, createdById: true, client: { select: { accountCode: true, legalName: true } } },
      orderBy: { createdAt: 'asc' }, take: 5000,
    });
    const picks = s.length ? await this.prisma.pickupRequest.findMany({ where: { pickedAwb: { in: s.map((x) => x.awb) } }, select: { pickedAwb: true, vendor: true, createdByName: true } }) : [];
    const pickBy = new Map(picks.map((p) => [p.pickedAwb, p]));
    const uids = [...new Set(s.map((x) => x.createdById).filter((v): v is bigint => v != null))];
    const uname = new Map((uids.length ? await this.prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, fullName: true } }) : []).map((u) => [u.id.toString(), u.fullName]));
    const rows = s.map((x) => {
      const pk = pickBy.get(x.awb);
      return {
        awb: x.awb, booked: new Date(+x.createdAt + 330 * 60000).toISOString().slice(0, 10), customer: `${x.client?.accountCode ?? ''} ${x.client?.legalName ?? ''}`.trim(),
        product: x.product || '—', vendor: pk?.vendor || x.vendor || '— not assigned', bookedBy: pk?.createdByName || (x.createdById != null ? uname.get(x.createdById.toString()) : null) || '—',
        status: STATUS_LABEL[String(x.statusCode || 'MAN')] ?? x.statusCode, consignee: x.consigneeName || '—', pincode: x.destPincode || '—',
      };
    });
    return {
      columns: [{ key: 'awb', label: 'AWB' }, { key: 'booked', label: 'Booked' }, { key: 'customer', label: 'Customer' }, { key: 'product', label: 'Product' }, { key: 'vendor', label: 'Vendor (assigned at pickup)' }, { key: 'bookedBy', label: 'Booked by' }, { key: 'status', label: 'Status' }, { key: 'consignee', label: 'Consignee' }, { key: 'pincode', label: 'Pincode' }],
      rows, note: 'Own-network (LOGM) and cancelled AWBs are left out.',
    };
  }

  /** Gaps in OUR AWB series (L…) — numbers that were never booked. */
  private async awbGaps(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range, awb: { startsWith: 'L' } }, select: { awb: true }, take: 20000 });
    const nums = s.map((x) => { const m = x.awb.match(/^L(\d+)$/); return m ? Number(m[1]) : NaN; }).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    if (nums.length < 2) return { columns: [{ key: 'msg', label: 'Info' }], rows: [{ msg: 'Not enough AWBs to detect gaps.' }] };
    const min = nums[0], max = nums[nums.length - 1];
    if (max - min > 5000) return { columns: [{ key: 'msg', label: 'Info' }], rows: [{ msg: 'AWB range too large to enumerate — narrow the date range.' }] };
    const present = new Set(nums);
    const rows: { missing: string }[] = [];
    for (let i = min; i <= max; i++) if (!present.has(i)) rows.push({ missing: `L${i}` });
    return { columns: [{ key: 'missing', label: 'Missing AWB number' }], rows: rows.length ? rows : [{ missing: 'None — sequence is complete' }] };
  }

  private async customerRegister(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['clientId'], where: { createdAt: range }, _count: { _all: true }, _sum: { declaredValue: true } });
    const clients = await this.prisma.b2bClient.findMany({ select: { id: true, legalName: true } });
    const nm = new Map(clients.map((c) => [c.id.toString(), c.legalName]));
    const rows = g
      .map((x) => ({ customer: nm.get(x.clientId.toString()) || x.clientId.toString(), shipments: x._count._all, invoiceValue: Number(x._sum.declaredValue || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'customer', label: 'Customer' }, { key: 'shipments', label: 'Shipments' }, { key: 'invoiceValue', label: 'Invoice value ₹' }], rows };
  }

  private async receivables(): Promise<Report> {
    const c = await this.prisma.b2bClient.findMany({ where: { outstandingBal: { gt: 0 } }, select: { legalName: true, outstandingBal: true, creditLimit: true, creditDays: true, isCreditHold: true } });
    const rows = c
      .map((x) => ({ customer: x.legalName, outstanding: Number(x.outstandingBal).toFixed(2), creditLimit: Number(x.creditLimit).toFixed(2), creditDays: x.creditDays, hold: x.isCreditHold ? 'YES' : '' }))
      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    return { columns: [{ key: 'customer', label: 'Customer' }, { key: 'outstanding', label: 'Outstanding ₹' }, { key: 'creditLimit', label: 'Credit limit ₹' }, { key: 'creditDays', label: 'Credit days' }, { key: 'hold', label: 'Hold' }], rows };
  }
}
