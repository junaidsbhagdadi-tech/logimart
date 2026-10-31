import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RateService } from '../billing/rate.service';

/**
 * End-of-day summary emails (9 PM IST). Branch mails (DEL / BOM — customers by their Branch) carry the
 * operations numbers; the All-India mail adds weight + sales month-to-date, outstanding and collection.
 * Routing defaults below; override with a CONFIG master entry DAILY_SUMMARY → attrs.routes =
 * [{ "email": "x@y", "scope": "DEL" | "BOM" | "ALL" }, …].
 */
type Scope = 'DEL' | 'BOM' | 'ALL';
const DEFAULT_ROUTES: { email: string; scope: Scope }[] = [
  { email: 'raghav@logimart.co.in', scope: 'DEL' },
  { email: 'sarvesh@logimart.co.in', scope: 'BOM' },
  { email: 'mahesh@logimart.co.in', scope: 'DEL' },
  { email: 'mahesh@logimart.co.in', scope: 'BOM' },
  { email: 'rahul@logimart.co.in', scope: 'ALL' },
];
// Customer.branch codes per summary branch (HO = Delhi head office, HO-BOM = Mumbai regional office).
const BRANCHES: Record<Exclude<Scope, 'ALL'>, string[]> = { DEL: ['DEL', 'HO'], BOM: ['BOM', 'HO-BOM'] };
const OPEN_WINDOW_DAYS = 60; // older open shipments carry stale statuses — keep the counts honest

@Injectable()
export class DailySummaryService {
  private readonly log = new Logger('DailySummary');
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService, private readonly rates: RateService) {}

  @Cron('0 21 * * *', { timeZone: 'Asia/Kolkata' })
  async scheduled() {
    if (String(process.env.DAILY_SUMMARY ?? 'true').toLowerCase() === 'false') return;
    try { const r = await this.sendAll(); this.log.log(`Daily summary sent: ${r.sent}/${r.total}`); }
    catch (e: any) { this.log.error(`Daily summary failed: ${e?.message || e}`); }
  }

  async routes(): Promise<{ email: string; scope: Scope }[]> {
    const cfg = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'CONFIG', code: 'DAILY_SUMMARY' } } }).catch(() => null);
    const r = (cfg?.attrs as any)?.routes;
    const list = Array.isArray(r) && r.length && cfg?.active !== false ? r : DEFAULT_ROUTES;
    return list.map((x: any) => ({ email: NotificationsService.cleanEmail(x.email), scope: (['DEL', 'BOM', 'ALL'].includes(String(x.scope).toUpperCase()) ? String(x.scope).toUpperCase() : 'ALL') as Scope }))
      .filter((x: any) => x.email);
  }

  /** Customer ids in a branch scope (null = all-India). */
  private async scopeIds(scope: Scope): Promise<bigint[] | null> {
    if (scope === 'ALL') return null;
    const rows = await this.prisma.b2bClient.findMany({ where: { branch: { in: BRANCHES[scope] } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async numbers(scope: Scope) {
    const ids = await this.scopeIds(scope);
    const c = ids ? { clientId: { in: ids } } : {};
    const ist = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const today = new Date(`${ist}T00:00:00+05:30`);
    const month = new Date(`${ist.slice(0, 8)}01T00:00:00+05:30`);
    const recent = new Date(Date.now() - OPEN_WINDOW_DAYS * 864e5);
    const notCan = { NOT: { statusCode: 'CAN' } };
    const [bookedToday, deliveredToday, inTransit, ndr, delayed, rto, notHanded, notPicked] = await Promise.all([
      this.prisma.shipment.aggregate({ where: { ...c, ...notCan, createdAt: { gte: today } }, _count: true, _sum: { totalDeadKg: true, chargeWeight: true } }),
      this.prisma.shipment.count({ where: { ...c, statusCode: 'DLD', statusAt: { gte: today } } }),
      this.prisma.shipment.count({ where: { ...c, statusCode: { in: ['PKD', 'ORD', 'DPD', 'DRD', 'OFD'] }, createdAt: { gte: recent } } }),
      this.prisma.shipment.count({ where: { ...c, statusCode: 'UDL', createdAt: { gte: recent } } }),
      this.prisma.shipment.count({ where: { ...c, statusCode: { in: ['PKD', 'ORD', 'DPD', 'DRD', 'OFD', 'UDL'] }, expectedDelivery: { lt: today }, createdAt: { gte: recent } } }),
      this.prisma.shipment.count({ where: { ...c, statusCode: 'RTO', createdAt: { gte: recent } } }),
      this.prisma.pickupRequest.count({ where: { ...c, status: { in: ['REQUESTED', 'ASSIGNED'] }, token: null } }),
      this.prisma.pickupRequest.count({ where: { ...c, status: { in: ['REQUESTED', 'ASSIGNED'] } } }),
    ]);
    const kg = (a: any) => +Number(a?._sum?.totalDeadKg ?? 0).toFixed(2);
    const out: Record<string, any> = {
      scope, date: ist,
      bookedToday: bookedToday._count, bookedTodayKg: kg(bookedToday),
      deliveredToday, inTransit, ndr, delayed, rto, pickupsNotHandedOff: notHanded, pickupsNotPicked: notPicked,
    };
    if (scope === 'ALL') {
      const [mtd, outstanding, collected] = await Promise.all([
        this.prisma.shipment.aggregate({ where: { ...notCan, createdAt: { gte: month } }, _count: true, _sum: { totalDeadKg: true } }),
        this.prisma.b2bClient.aggregate({ _sum: { outstandingBal: true } }),
        this.prisma.ledgerEntry.aggregate({ where: { createdAt: { gte: today }, entryType: { in: ['payment', 'wallet_topup'] } }, _sum: { amount: true } }),
      ]);
      out.mtdBooked = mtd._count; out.mtdKg = kg(mtd);
      const sales = await this.sales(month, today);
      out.salesToday = sales.today; out.salesMtd = sales.mtd; out.salesEstimated = sales.estimated;
      out.outstanding = +Number(outstanding._sum.outstandingBal ?? 0).toFixed(2);
      out.collectionToday = Math.abs(+Number(collected._sum.amount ?? 0).toFixed(2));
    }
    return out;
  }

  /** Sales (pre-GST): the invoiced amount where billed, else the rate engine's price — today and month-to-date. */
  private async sales(month: Date, today: Date) {
    const ships = await this.prisma.shipment.findMany({
      where: { createdAt: { gte: month }, NOT: { statusCode: 'CAN' }, client: { isCash: false } },
      include: { pieces: { select: { status: true, deadKg: true, volKg: true, lengthCm: true, widthCm: true, heightCm: true } }, invoiceLines: { select: { amount: true }, take: 1 } },
    });
    let mtd = 0, td = 0, estimated = 0;
    const one = async (s: any) => {
      let amt = s.invoiceLines?.[0] ? Number(s.invoiceLines[0].amount) : NaN;
      if (isNaN(amt)) { const b: any = await this.rates.chargesForShipment(s, s.pieces).catch(() => null); amt = Number(b?.subtotal ?? 0); estimated++; }
      mtd += amt; if (+s.createdAt >= +today) td += amt;
    };
    for (let i = 0; i < ships.length; i += 12) await Promise.all(ships.slice(i, i + 12).map(one));
    return { today: +td.toFixed(2), mtd: +mtd.toFixed(2), estimated };
  }

  private render(n: Record<string, any>) {
    const inr = (v: number) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    const kg = (v: number) => `${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`;
    const title = n.scope === 'ALL' ? 'All India' : n.scope === 'DEL' ? 'Delhi (DEL)' : 'Mumbai (BOM)';
    const date = String(n.date).split('-').reverse().join('-');
    const rows: [string, string][] = [
      ['Booked today', `${n.bookedToday} AWB · ${kg(n.bookedTodayKg)}`],
      ...(n.scope === 'ALL' ? [['Booked this month', `${n.mtdBooked} AWB · ${kg(n.mtdKg)}`] as [string, string], ['Sales today', inr(n.salesToday)] as [string, string], ['Sales this month', inr(n.salesMtd)] as [string, string]] : []),
      ['Delivered today', String(n.deliveredToday)],
      ['AWBs in transit', String(n.inTransit)],
      ['In NDR (undelivered)', String(n.ndr)],
      ['Delayed (past EDD)', String(n.delayed)],
      ...(n.scope !== 'ALL' ? [['In RTO', String(n.rto)] as [string, string]] : []),
      ['Pickups not handed off', String(n.pickupsNotHandedOff)],
      ['Pickups booked, not marked picked', String(n.pickupsNotPicked)],
      ...(n.scope === 'ALL' ? [['Total outstanding', inr(n.outstanding)] as [string, string], ["Today's collection", inr(n.collectionToday)] as [string, string]] : []),
    ];
    const text = [`Logimart daily summary — ${title} — ${date}`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', n.scope === 'ALL' && n.salesEstimated ? `Sales of not-yet-invoiced AWBs (${n.salesEstimated}) are at the rate-card price.` : ''].join('\n').trim();
    const html = `<div style="font:14px Arial,sans-serif;color:#1d2a2a"><h2 style="margin:0 0 4px;font-size:18px">Daily summary — ${title}</h2><div style="color:#667;margin-bottom:12px">${date}</div>
<table style="border-collapse:collapse;min-width:340px">${rows.map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;border-bottom:1px solid #e3e8e8;color:#556">${k}</td><td style="padding:6px 0;border-bottom:1px solid #e3e8e8;font-weight:700;text-align:right">${v}</td></tr>`).join('')}</table>
${n.scope === 'ALL' && n.salesEstimated ? `<p style="color:#889;font-size:12px">Sales of not-yet-invoiced AWBs (${n.salesEstimated}) are at the rate-card price.</p>` : ''}
<p style="color:#889;font-size:12px">In transit / NDR / delayed / RTO count shipments booked in the last ${OPEN_WINDOW_DAYS} days.</p></div>`;
    return { subject: `Logimart daily summary — ${title} — ${date}`, text, html };
  }

  /** Send every route (or only `scope`, or a dry run that returns the numbers without mailing). */
  async sendAll(opts: { scope?: Scope; dry?: boolean } = {}) {
    const routes = (await this.routes()).filter((r) => !opts.scope || r.scope === opts.scope);
    const cache = new Map<Scope, any>();
    let sent = 0;
    const out: any[] = [];
    for (const r of routes) {
      if (!cache.has(r.scope)) cache.set(r.scope, await this.numbers(r.scope));
      const n = cache.get(r.scope);
      const m = this.render(n);
      let ok = false;
      if (!opts.dry) {
        ok = await this.notifications.sendMail({ to: [r.email], subject: m.subject, text: m.text, html: m.html }).catch(() => false);
        if (ok) sent++;
      }
      out.push({ email: r.email, scope: r.scope, sent: ok, numbers: n });
    }
    return { total: routes.length, sent, routes: out };
  }
}
