import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type Report = { columns: { key: string; label: string }[]; rows: any[] };

// Plain-English transport-mode labels — the raw enum (ROAD_PTL, AIR_EXPRESS…) is internal and
// confuses users, so report exports show the friendly label too (mirrors the web modeLabel).
const MODE_LABEL: Record<string, string> = {
  AIR_EXPRESS: 'Air (Express)', AIR_ECONOMY: 'Air (Economy)',
  ROAD_FTL: 'Surface (Full-load)', ROAD_PTL: 'Surface (Part-load)', RAIL: 'Surface (Rail)',
};
const modeLabel = (m: any) => MODE_LABEL[String(m ?? '').toUpperCase()] ?? (m ?? '—');

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

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
      `Logimart daily digest — ${dateStr}`,
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

  async run(type: string, from?: string, to?: string): Promise<Report> {
    const gte = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const lte = to ? new Date(new Date(to).getTime() + 86400000) : new Date();
    const range = { gte, lte };
    switch (type.toUpperCase()) {
      case 'MIS': return this.mis(range);
      case 'DAILY': return this.daily(range);
      case 'CUSTOMER_SUMMARY': return this.customerSummary(range);
      case 'PRODUCT_SUMMARY': return this.productSummary(range);
      case 'DESTINATION_SUMMARY': return this.destinationSummary(range);
      case 'DELIVERY_STATUS': return this.deliveryStatus(range);
      case 'SCAN': return this.scanReport(range);
      case 'RECEIVABLES': return this.receivables();
      case 'INVOICE': return this.invoiceReport();
      case 'VENDOR': return this.vendorReport();
      case 'MANIFEST': return this.manifestReport(range);
      case 'PICKUP': return this.pickupReport(range);
      case 'DRS': return this.drsReport(range);
      case 'COMMENT_VIEW': return this.commentView(range);
      case 'INSCAN': return this.inscan(range);
      case 'VOLUMETRIC': return this.volumetric(range);
      case 'VOID': return this.voidReport(range);
      case 'ZERO': return this.zeroReport(range);
      case 'LEDGER_AGING': return this.ledgerAging();
      case 'TARIFF': return this.tariff();
      case 'LOCATION_SUMMARY': return this.locationSummary(range);
      case 'NOT_INSCAN': return this.notInscan(range);
      case 'RUNSHEET_NOT_POD': return this.runsheetNotPod(range);
      case 'BILLING': return this.billing(range);
      case 'ACTION_LOG': return this.actionLog(range);
      case 'LOGIN_LOG': return this.loginLog(range);
      case 'MISSING_AWB': return this.missingAwb(range);
      case 'CUSTOMER_REGISTER': return this.customerRegister(range);
      case 'SLA': return this.slaSummary(range);
      case 'SLA_DETAIL': return this.slaDetail(range);
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

  private async productSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['product'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const rows = g
      .map((x) => ({ product: x.product || '—', shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'product', label: 'Product' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async destinationSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['destZone'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const rows = g
      .map((x) => ({ destination: x.destZone || '—', shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'destination', label: 'Destination zone' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async deliveryStatus(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['status'], where: { createdAt: range }, _count: { _all: true } });
    const rows = g.map((x) => ({ status: x.status, count: x._count._all })).sort((a, b) => b.count - a.count);
    return { columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Count' }], rows };
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

  private async vendorReport(): Promise<Report> {
    const v = await this.prisma.vendor.findMany({ orderBy: { name: 'asc' } });
    const rows = v.map((x) => ({ name: x.name, modes: x.modes, city: x.city || '—', gstin: x.gstin || '—', active: x.isActive ? 'Yes' : 'No' }));
    return { columns: [{ key: 'name', label: 'Vendor' }, { key: 'modes', label: 'Modes' }, { key: 'city', label: 'City' }, { key: 'gstin', label: 'GSTIN' }, { key: 'active', label: 'Active' }], rows };
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

  private async voidReport(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range, status: 'CANCELLED' as any }, select: { awb: true, consigneeName: true, createdAt: true }, orderBy: { id: 'desc' }, take: 1000 });
    const rows = s.map((x) => ({ awb: x.awb, consignee: x.consigneeName || '—', at: x.createdAt.toISOString().slice(0, 10) }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'consignee', label: 'Consignee' }, { key: 'at', label: 'Booked' }], rows };
  }

  private async zeroReport(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range, totalDeadKg: 0 }, select: { awb: true, product: true, pieceCount: true }, orderBy: { id: 'desc' }, take: 1000 });
    const rows = s.map((x) => ({ awb: x.awb, product: x.product || '—', pieces: x.pieceCount }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'product', label: 'Product' }, { key: 'pieces', label: 'Pcs' }], rows };
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

  /** Classify a delivered shipment against its promised EDD. Appointment deliveries are excluded
   *  (the date was customer-chosen); shipments with no promise date can't be measured. */
  private slaClassify(s: any): 'ONTIME' | 'DELAYED' | 'EXCLUDED' | 'NO_PROMISE' {
    if (!s.expectedDelivery || !s.statusAt) return 'NO_PROMISE';
    if (s.apptDelivery) return 'EXCLUDED';
    const promised = new Date(s.expectedDelivery); promised.setHours(23, 59, 59, 999);
    return new Date(s.statusAt) <= promised ? 'ONTIME' : 'DELAYED';
  }
  private slaDaysLate(s: any): number {
    if (!s.expectedDelivery || !s.statusAt) return 0;
    const d = new Date(s.statusAt); d.setHours(0, 0, 0, 0);
    const p = new Date(s.expectedDelivery); p.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((d.getTime() - p.getTime()) / 86400000));
  }
  private async slaDelivered(range: any) {
    return this.prisma.shipment.findMany({
      where: { statusCode: 'DLD', statusAt: range },
      select: { awb: true, clientId: true, consigneeCity: true, destZone: true, serviceMode: true, createdAt: true, expectedDelivery: true, statusAt: true, apptDelivery: true },
    });
  }

  /** On-time vs delay SLA summary — delivered shipments measured against their promised EDD,
   *  excluding appointment (customer-scheduled) deliveries and those with no promise date. */
  private async slaSummary(range: any): Promise<Report> {
    const ships = await this.slaDelivered(range);
    let ontime = 0, delayed = 0, excluded = 0, noPromise = 0, delaySum = 0;
    for (const s of ships) {
      const c = this.slaClassify(s);
      if (c === 'ONTIME') ontime++;
      else if (c === 'DELAYED') { delayed++; delaySum += this.slaDaysLate(s); }
      else if (c === 'EXCLUDED') excluded++;
      else noPromise++;
    }
    const measured = ontime + delayed;
    const pct = (n: number) => (measured ? ((n / measured) * 100).toFixed(1) + '%' : '—');
    const rows = [
      { metric: 'Delivered in range', value: ships.length, note: '' },
      { metric: 'Measured against promise (EDD)', value: measured, note: 'excludes appointment & no-promise' },
      { metric: '✅ On-time', value: ontime, note: pct(ontime) },
      { metric: '🔴 Delayed', value: delayed, note: pct(delayed) },
      { metric: 'Avg delay on delayed (days)', value: delayed ? (delaySum / delayed).toFixed(1) : '0', note: '' },
      { metric: '⏸ Excluded — appointment / customer-scheduled', value: excluded, note: '' },
      { metric: 'No promise date (unmeasured)', value: noPromise, note: '' },
    ];
    return { columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }, { key: 'note', label: 'Note' }], rows };
  }

  /** Per-AWB SLA detail — every delivered AWB with its promise vs actual and result, worst delays first. */
  private async slaDetail(range: any): Promise<Report> {
    const ships = await this.slaDelivered(range);
    const clients = await this.prisma.b2bClient.findMany({ select: { id: true, legalName: true } });
    const nm = new Map(clients.map((c) => [c.id.toString(), c.legalName]));
    const d10 = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
    const label: Record<string, string> = { ONTIME: '✅ On-time', DELAYED: '🔴 Delayed', EXCLUDED: '⏸ Appt-excluded', NO_PROMISE: '— no promise' };
    const rows = ships.map((s) => {
      const cls = this.slaClassify(s);
      const late = this.slaDaysLate(s);
      return {
        awb: s.awb,
        customer: nm.get(s.clientId.toString()) || s.clientId.toString(),
        dest: s.consigneeCity || s.destZone || '—',
        mode: modeLabel(s.serviceMode),
        booked: d10(s.createdAt),
        promised: d10(s.expectedDelivery),
        delivered: d10(s.statusAt),
        daysLate: cls === 'DELAYED' ? late : 0,
        result: cls === 'DELAYED' ? `${label[cls]} (${late}d)` : label[cls],
        _sort: cls === 'DELAYED' ? late : -1,
      };
    }).sort((a, b) => b._sort - a._sort).map(({ _sort, ...r }) => r);
    return { columns: [
      { key: 'awb', label: 'AWB' }, { key: 'customer', label: 'Customer' }, { key: 'dest', label: 'Destination' },
      { key: 'mode', label: 'Mode' }, { key: 'booked', label: 'Booked' }, { key: 'promised', label: 'Promised (EDD)' },
      { key: 'delivered', label: 'Delivered' }, { key: 'daysLate', label: 'Days late' }, { key: 'result', label: 'Result' },
    ], rows };
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

  private async billing(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range }, select: { awb: true, product: true, chargeWeight: true, charges: true, declaredValue: true }, orderBy: { id: 'desc' }, take: 1000 });
    const rows = s
      .filter((x) => Array.isArray(x.charges) && (x.charges as any[]).length > 0)
      .map((x) => {
        const total = (x.charges as any[]).reduce((t, c) => t + Number(c.amount || 0), 0);
        return { awb: x.awb, product: x.product || '—', chargeKg: x.chargeWeight != null ? Number(x.chargeWeight).toFixed(2) : '—', charges: total.toFixed(2), invoiceValue: x.declaredValue != null ? Number(x.declaredValue).toFixed(2) : '—' };
      });
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'product', label: 'Product' }, { key: 'chargeKg', label: 'Charge kg' }, { key: 'charges', label: 'Charges ₹' }, { key: 'invoiceValue', label: 'Invoice value ₹' }], rows };
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

  private async missingAwb(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range }, select: { awb: true }, take: 5000 });
    const nums = s.map((x) => { const m = x.awb.match(/(\d+)$/); return m ? Number(m[1]) : NaN; }).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    if (nums.length < 2) return { columns: [{ key: 'msg', label: 'Info' }], rows: [{ msg: 'Not enough AWBs to detect gaps.' }] };
    const min = nums[0], max = nums[nums.length - 1];
    if (max - min > 5000) return { columns: [{ key: 'msg', label: 'Info' }], rows: [{ msg: 'AWB range too large to enumerate — narrow the date range.' }] };
    const present = new Set(nums);
    const rows: { missing: number }[] = [];
    for (let i = min; i <= max; i++) if (!present.has(i)) rows.push({ missing: i });
    return { columns: [{ key: 'missing', label: 'Missing AWB number' }], rows: rows.length ? rows : [{ missing: 'None — sequence is complete' as any }] };
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
