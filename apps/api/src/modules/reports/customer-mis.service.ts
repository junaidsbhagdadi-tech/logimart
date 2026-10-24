import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { pinRows, placeName } from '../../common/place-name';

/**
 * Daily customer MIS — each customer gets their shipments booked in the last 7 days that are still open (not
 * delivered / returned / cancelled) plus the ones delivered yesterday, as a CSV (opens in Excel), at 09:00 IST Mon–Sat.
 * To: the customer's email + second email · CC: the salesperson and CS person on the customer.
 * Env: CUSTOMER_MIS_AUTOSEND ('false' to stop) · CUSTOMER_MIS_START (first day, default 2026-10-26).
 */
const STATUS: Record<string, string> = {
  MAN: 'Booked', PKD: 'Picked up', ORD: 'At origin hub', DPD: 'In transit', DRD: 'At destination hub',
  OFD: 'Out for delivery', DLD: 'Delivered', UDL: 'Undelivered', RTO: 'Return to origin', RTD: 'Returned', CAN: 'Cancelled',
};
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const emails = (...v: (string | null | undefined)[]) => [...new Set(v.flatMap((x) => String(x ?? '').split(/[,;\s]+/)).map((x) => x.trim().toLowerCase()).filter((x) => EMAIL.test(x)))];
const p2 = (n: number) => String(n).padStart(2, '0');
const ist = (d: Date | null | undefined, time = false) => {
  if (!d) return '';
  const t = new Date(new Date(d).getTime() + 330 * 60000);
  return `${p2(t.getUTCDate())}-${p2(t.getUTCMonth() + 1)}-${t.getUTCFullYear()}${time ? ` ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}` : ''}`;
};
const csvCell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

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

  /** One customer's MIS rows: open shipments + delivered yesterday. */
  async rows(clientId: bigint) {
    const y = this.yesterday();
    const list = await this.prisma.shipment.findMany({
      where: {
        clientId,
        OR: [
          // Open shipments booked in the last 7 days only — older bulk-uploaded ones carry stale statuses
          // (thousands still "Booked" weeks later), which must not reach customers until they're refreshed.
          { createdAt: { gte: new Date(y.to.getTime() - 7 * 864e5) }, OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] },
          { statusCode: 'DLD', statusAt: { gte: y.from, lt: y.to } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 5000,
      select: {
        awb: true, createdAt: true, referenceNo: true, custInvoiceNo: true, shipperCity: true, shipperPincode: true, consigneeName: true,
        consigneeCity: true, destPincode: true, destZone: true, pieceCount: true, chargeWeight: true, totalDeadKg: true, vendor: true,
        forwardingAwb: true, bdWaybill: true, statusCode: true, statusAt: true, expectedDelivery: true, bdStatus: true, exceptionFlag: true,
      },
    });
    const pins = await pinRows(this.prisma, list.flatMap((s) => [s.shipperPincode, s.destPincode]));
    return list.map((s) => {
      const code = String(s.statusCode || 'MAN');
      return {
        'AWB': s.awb, 'Booking Date': ist(s.createdAt), 'Reference': s.referenceNo || s.custInvoiceNo || '',
        'Origin': placeName(s.shipperCity, pins.get(String(s.shipperPincode || ''))), 'Destination': placeName(s.consigneeCity, pins.get(String(s.destPincode || '')), s.destZone),
        'Dest Pincode': s.destPincode || '', 'Consignee': s.consigneeName || '', 'Pcs': s.pieceCount,
        'Weight (kg)': Number(s.chargeWeight ?? s.totalDeadKg ?? 0).toFixed(2), 'Carrier': s.vendor || 'SELF', 'Carrier AWB': s.forwardingAwb || s.bdWaybill || '',
        'Status': STATUS[code] ?? code, 'Status Date': ist(s.statusAt, true), 'Expected Delivery': s.expectedDelivery && s.expectedDelivery >= s.createdAt ? ist(s.expectedDelivery) : '', // upload data has EDDs before booking
        'Delivered On': code === 'DLD' ? ist(s.statusAt, true) : '', 'Remarks': s.exceptionFlag || (s.bdStatus && !/^(Booked|Manifested|Docket created)/i.test(s.bdStatus) ? s.bdStatus : '') || '',
      };
    });
  }

  csv(rows: Record<string, any>[]): Buffer {
    if (!rows.length) return Buffer.from('﻿No shipments\n', 'utf8');
    const head = Object.keys(rows[0]);
    const body = [head.join(','), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(','))].join('\r\n');
    return Buffer.from('﻿' + body, 'utf8'); // BOM → Excel opens it as UTF-8
  }

  /** Build + send one customer's MIS. `overrideTo` sends it to an internal address instead (preview). */
  async sendFor(clientId: bigint, overrideTo?: string) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: clientId }, select: { legalName: true, accountCode: true, contactEmail: true, email2: true, salesPersonEmail: true, csPersonEmail: true } });
    if (!c) return { clientId: String(clientId), sent: false, reason: 'customer not found' };
    const to = overrideTo ? emails(overrideTo) : emails(c.contactEmail, c.email2);
    const cc = overrideTo ? [] : emails(c.salesPersonEmail, c.csPersonEmail).filter((e) => !to.includes(e));
    if (!to.length) return { clientId: String(clientId), code: c.accountCode, sent: false, reason: 'no customer email' };
    const rows = await this.rows(clientId);
    if (!rows.length) return { clientId: String(clientId), code: c.accountCode, sent: false, reason: 'nothing open or delivered yesterday' };
    const count = (st: string) => rows.filter((r) => r['Status'] === st).length;
    const today = ist(new Date());
    const deliveredY = rows.filter((r) => r['Delivered On']).length;
    const summary = [
      `Shipments in this report: ${rows.length}`,
      `Delivered yesterday: ${deliveredY}`,
      `In transit / at hub: ${rows.length - deliveredY - count('Undelivered') - count('Out for delivery') - count('Booked') - count('Return to origin')}`,
      `Out for delivery: ${count('Out for delivery')}`,
      `Undelivered (needs attention): ${count('Undelivered')}`,
      `Return to origin: ${count('Return to origin')}`,
      `Booked, awaiting pickup: ${count('Booked')}`,
    ];
    const text = [`Dear ${c.legalName},`, '', `Please find attached your shipment MIS as on ${today}.`, '', ...summary, '', 'For any query, reply to this email or contact your account manager.', '', 'Regards,', 'Logimart Customer Service'].join('\n');
    const ok = await this.notify.sendMail({
      to, cc, subject: `Shipment MIS — ${c.legalName} (${c.accountCode}) — ${today}`, text,
      attachments: [{ filename: `MIS_${c.accountCode}_${today}.csv`, content: this.csv(rows), contentType: 'text/csv' }],
    });
    return { clientId: String(clientId), code: c.accountCode, sent: ok, to, cc, rows: rows.length };
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
