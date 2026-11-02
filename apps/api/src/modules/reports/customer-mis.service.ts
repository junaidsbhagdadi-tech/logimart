import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { pinRows, placeName } from '../../common/place-name';
import * as XLSX from 'xlsx';

/**
 * Daily customer MIS — each customer gets EVERY shipment booked in the last 30 days (any status except
 * cancelled — delivered ones too) plus older ones delivered yesterday, as an Excel file, at 09:00 IST Mon–Sat.
 * A STATUS report only — no weights or charges.
 * To: the customer's email + second email · CC: the salesperson and CS person on the customer.
 * Env: CUSTOMER_MIS_AUTOSEND ('false' to stop) · CUSTOMER_MIS_START (first day, default 2026-10-26).
 */
const STATUS: Record<string, string> = {
  MAN: 'Booked', PKD: 'Picked up', ORD: 'At origin hub', DPD: 'In transit', DRD: 'At destination hub',
  OFD: 'Out for delivery', DLD: 'Delivered', UDL: 'Undelivered', RTO: 'Return to origin', RTD: 'Returned', CAN: 'Cancelled',
};
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
// Cleaned (<x@y>, 'x@y', x@y> → x@y) then de-duplicated — the same person typed two ways used to get two mails.
const emails = (...v: (string | null | undefined)[]) => [...new Set(v.flatMap((x) => String(x ?? '').split(/[,;\s]+/)).map((x) => NotificationsService.cleanEmail(x)).filter((x) => x && EMAIL.test(x)))];
const p2 = (n: number) => String(n).padStart(2, '0');
const ist = (d: Date | null | undefined, time = false) => {
  if (!d) return '';
  const t = new Date(new Date(d).getTime() + 330 * 60000);
  return `${p2(t.getUTCDate())}-${p2(t.getUTCMonth() + 1)}-${t.getUTCFullYear()}${time ? ` ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}` : ''}`;
};
const csvCell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BRAND = 'ExcelEx Group';

@Injectable()
export class CustomerMisService {
  private readonly log = new Logger('CustomerMIS');
  constructor(private readonly prisma: PrismaService, private readonly notify: NotificationsService) {}

  /** Yesterday's IST day as [start, end) UTC instants. */
  private yesterday() {
    const now = new Date(Date.now() + 330 * 60000);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 330 * 60000;
    return { from: new Date(today - 864e5), to: new Date(today) };
  }

  /** One customer's MIS rows (see data()). */
  async rows(clientId: bigint) { return (await this.data(clientId)).mis; }

  /**
   * The MIS: every shipment booked in the last month, PLUS every older one still not delivered (it stays on
   * the sheet until it's delivered / returned) — limited to 120 days and to ones that actually moved
   * (picked or later), because old bulk uploads carry stale "Booked" statuses. The NDR / pending sheet is
   * every not-yet-delivered shipment with its current carrier status.
   */
  async data(clientId: bigint) {
    const y = this.yesterday();
    const monthAgo = new Date(y.to.getTime() - 30 * 864e5);
    const list = await this.prisma.shipment.findMany({
      where: {
        clientId,
        OR: [
          { createdAt: { gte: monthAgo }, OR: [{ statusCode: null }, { statusCode: { not: 'CAN' } }] },
          { createdAt: { gte: new Date(y.to.getTime() - 120 * 864e5), lt: monthAgo }, statusCode: { in: ['PKD', 'ORD', 'DPD', 'DRD', 'OFD', 'UDL', 'RTO'] } },
          { statusCode: 'DLD', statusAt: { gte: y.from, lt: y.to } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 5000,
      select: {
        awb: true, createdAt: true, referenceNo: true, custInvoiceNo: true, shipperCity: true, shipperPincode: true, consigneeName: true,
        consigneeCity: true, destPincode: true, destZone: true, pieceCount: true, vendor: true,
        forwardingAwb: true, bdWaybill: true, statusCode: true, statusAt: true, expectedDelivery: true, bdStatus: true, exceptionFlag: true,
      },
    });
    const pins = await pinRows(this.prisma, list.flatMap((s) => [s.shipperPincode, s.destPincode]));
    const carrierNow = (s: any) => (s.bdStatus && !/^(Booked|Manifested|Docket created)/i.test(s.bdStatus) ? String(s.bdStatus) : '');
    const mis = list.map((s) => {
      const code = String(s.statusCode || 'MAN');
      return {
        'AWB': s.awb, 'Booking Date': ist(s.createdAt), 'Reference': s.referenceNo || s.custInvoiceNo || '',
        'Origin': placeName(s.shipperCity, pins.get(String(s.shipperPincode || ''))), 'Destination': placeName(s.consigneeCity, pins.get(String(s.destPincode || '')), s.destZone),
        'Consignee': s.consigneeName || '', 'Pcs': s.pieceCount,
        'Carrier': s.vendor || 'SELF', 'Carrier AWB': s.forwardingAwb || s.bdWaybill || '',
        'Status': STATUS[code] ?? code, 'Status Date': ist(s.statusAt, true), 'Expected Delivery': s.expectedDelivery && s.expectedDelivery >= s.createdAt ? ist(s.expectedDelivery) : '', // upload data has EDDs before booking
        'Delivered On': code === 'DLD' ? ist(s.statusAt, true) : '', 'Current Status (Carrier)': carrierNow(s), 'Remarks': s.exceptionFlag || '',
      };
    });
    const isOpen = (s: any) => !['DLD', 'RTD', 'CAN'].includes(String(s.statusCode || 'MAN'));
    const ndr = list.filter(isOpen).map((s) => {
      const code = String(s.statusCode || 'MAN');
      const age = Math.floor((Date.now() - +s.createdAt) / 864e5);
      return {
        'AWB': s.awb, 'Booking Date': ist(s.createdAt), 'Reference': s.referenceNo || s.custInvoiceNo || '',
        'Destination': placeName(s.consigneeCity, pins.get(String(s.destPincode || '')), s.destZone), 'Consignee': s.consigneeName || '',
        'Carrier': s.vendor || 'SELF', 'Carrier AWB': s.forwardingAwb || s.bdWaybill || '',
        'Status': STATUS[code] ?? code, 'Current Status (Carrier)': carrierNow(s) || (STATUS[code] ?? code), 'Status Date': ist(s.statusAt, true),
        'NDR': code === 'UDL' ? 'YES' : '', 'Age (days)': age, 'Expected Delivery': s.expectedDelivery && s.expectedDelivery >= s.createdAt ? ist(s.expectedDelivery) : '',
        'Remark': s.exceptionFlag || (code === 'UDL' ? 'Undelivered — awaiting re-attempt' : ''),
      };
    });
    const count = (codes: string[]) => list.filter((s) => codes.includes(String(s.statusCode || 'MAN'))).length;
    const summary = { delivered: count(['DLD']), returned: count(['RTO', 'RTD']), ndr: count(['UDL']), total: list.length };
    return { mis, ndr, summary: { ...summary, undelivered: summary.total - summary.delivered - summary.returned } };
  }

  csv(rows: Record<string, any>[]): Buffer {
    if (!rows.length) return Buffer.from('﻿No shipments\n', 'utf8');
    const head = Object.keys(rows[0]);
    const body = [head.join(','), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(','))].join('\r\n');
    return Buffer.from('﻿' + body, 'utf8'); // BOM → Excel opens it as UTF-8
  }

  xlsx(rows: Record<string, any>[], ndr?: Record<string, any>[]): Buffer {
    const sheet = (list: Record<string, any>[], empty: string) => {
      const ws = list.length ? XLSX.utils.json_to_sheet(list) : XLSX.utils.aoa_to_sheet([[empty]]);
      if (list.length) {
        const head = Object.keys(list[0]);
        ws['!cols'] = head.map((h) => ({ wch: Math.min(40, Math.max(h.length, ...list.map((r) => String(r[h] ?? '').length)) + 2) }));
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length, c: head.length - 1 } }) };
      }
      return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(rows, 'No shipments'), 'MIS REPORT');
    if (ndr) XLSX.utils.book_append_sheet(wb, sheet(ndr, 'Nothing pending — all delivered'), 'NDR & PENDING');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /** Build + send one customer's MIS. `overrideTo` sends it to an internal address instead (preview). */
  async sendFor(clientId: bigint, overrideTo?: string) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: clientId }, select: { legalName: true, accountCode: true, contactEmail: true, email2: true, salesPersonEmail: true, csPersonEmail: true } });
    if (!c) return { clientId: String(clientId), sent: false, reason: 'customer not found' };
    const to = overrideTo ? emails(overrideTo) : emails(c.contactEmail, c.email2);
    const cc = overrideTo ? [] : emails(c.salesPersonEmail, c.csPersonEmail).filter((e) => !to.includes(e));
    if (!to.length) return { clientId: String(clientId), code: c.accountCode, sent: false, reason: 'no customer email' };
    const { mis: rows, ndr, summary } = await this.data(clientId);
    if (!rows.length) return { clientId: String(clientId), code: c.accountCode, sent: false, reason: 'nothing open or delivered yesterday' };
    const now = new Date(Date.now() + 330 * 60000);
    const day = `${now.getUTCFullYear()}-${p2(now.getUTCMonth() + 1)}-${p2(now.getUTCDate())}`;
    const asOn = `${p2(now.getUTCDate())}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getUTCMonth()]}-${now.getUTCFullYear()}`;
    const name = String(c.legalName || c.accountCode);
    const subject = `MIS Report (${day}) for ${name}`;
    const counts: [string, number, string][] = [['Delivered', summary.delivered, '#1e7d32'], ['Undelivered', summary.undelivered, '#c77700'], ['Returned', summary.returned, '#c62828'], ['Total', summary.total, '#0d47a1']];
    const lines = [
      `Report as on ${asOn}`, '', 'Hello,', '',
      'Please find your MIS Report attached. We hope this helps you keep track of all your consignments.',
      'The NDR & PENDING sheet lists every shipment not yet delivered with its current carrier status.',
      'You may get in touch with your SPOC for any further assistance.', '',
      ...counts.map(([k, v]) => `${k}: ${v}`), summary.ndr ? `(of which NDR / undelivered attempts: ${summary.ndr})` : '', '',
      'Thanks & Regards', BRAND,
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d2a2a">
<div style="color:#8aa;font-size:12px">Report as on ${asOn}</div>
<p>Hello,</p>
<p>Please find your <b>MIS Report</b> attached. We hope this helps you keep track of all your consignments.<br>
The <b>NDR &amp; PENDING</b> sheet lists every shipment not yet delivered with its current carrier status.<br>
You may get in touch with your SPOC for any further assistance.</p>
<table style="border-collapse:collapse;min-width:320px;border:1px solid #e3e8e8">${counts.map(([k, v, col], i) => `<tr style="background:${i % 2 ? '#f7f9f9' : '#fff'}${k === 'Total' ? ';background:#eef4fb' : ''}"><td style="padding:10px 14px;color:${col};font-weight:700">${k}</td><td style="padding:10px 14px;text-align:right;font-weight:700">${v}</td></tr>`).join('')}</table>
${summary.ndr ? `<p style="font-size:12px;color:#667">of which NDR / undelivered attempts: <b>${summary.ndr}</b></p>` : ''}
<p><b>Thanks &amp; Regards</b><br><b>${BRAND}</b></p></div>`;
    const ok = await this.notify.sendMail({
      to, cc, subject, text: lines.join('\n'), html,
      attachments: [{ filename: `MIS Report (${day}) - ${c.accountCode}.xlsx`, content: this.xlsx(rows, ndr), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
    });
    return { clientId: String(clientId), code: c.accountCode, sent: ok, to, cc, rows: rows.length, pending: ndr.length, summary };
  }

  /** Every active customer with an email. */
  async sendAll() {
    const clients = await this.prisma.b2bClient.findMany({ where: { isActive: true }, select: { id: true } });
    const results: any[] = [];
    for (const c of clients) {
      try { results.push(await this.sendFor(c.id)); } catch (e: any) { results.push({ clientId: String(c.id), sent: false, reason: String(e?.message || e) }); }
      await new Promise((r) => setTimeout(r, 500)); // gentle on the mail provider
    }
    const sent = results.filter((r: any) => r.sent).length;
    this.log.log(`Customer MIS: sent ${sent}, skipped ${results.length - sent}.`);
    return { sent, total: results.length, results };
  }

  @Cron('0 9 * * 1-6', { timeZone: 'Asia/Kolkata' })
  async scheduled() {
    if (String(process.env.CUSTOMER_MIS_AUTOSEND ?? 'true').toLowerCase() === 'false') return;
    const start = String(process.env.CUSTOMER_MIS_START ?? '2026-10-26');
    if (new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) < start) return;
    // One instance only: claim today's run in Postgres (the API can run more than one process).
    const key = `CUSTOMER_MIS_RUN:${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)}`;
    const claimed = await this.prisma.integrationToken.create({ data: { provider: key, token: 'running', expiresAt: new Date(Date.now() + 3 * 864e5) } }).then(() => true).catch(() => false);
    if (!claimed) return;
    await this.sendAll();
  }
}
