import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Revenue by month for the last N months (for the dashboard trend chart). */
  private async revenueTrend(months = 6) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const invoices = await this.prisma.invoice.findMany({ where: { issuedAt: { gte: start } }, select: { total: true, issuedAt: true } });
    const buckets: { key: string; label: string; total: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), total: 0 });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const inv of invoices) {
      if (!inv.issuedAt) continue;
      const d = new Date(inv.issuedAt);
      const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (i != null) buckets[i].total += Number(inv.total);
    }
    return buckets.map((b) => ({ label: b.label, total: +b.total.toFixed(2) }));
  }

  async overview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [byStatus, total, exceptions, clients, monthInvoices, piecesInTransit, revenueTrend] = await Promise.all([
      this.prisma.shipment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.shipment.count(),
      this.prisma.shipment.count({ where: { status: { in: ['EXCEPTION', 'PARTIAL'] } } }),
      this.prisma.b2bClient.findMany({ select: { outstandingBal: true, isCreditHold: true } }),
      this.prisma.invoice.findMany({
        where: { issuedAt: { gte: monthStart } },
        select: { total: true },
      }),
      this.prisma.shipmentPiece.count({ where: { status: { in: ['LOADED', 'IN_TRANSIT'] } } }),
      this.revenueTrend(6),
    ]);

    const statusMap: Record<string, number> = {};
    for (const r of byStatus) statusMap[r.status] = r._count._all;
    const delivered = statusMap['DELIVERED'] ?? 0;

    return {
      shipments: { total, byStatus: statusMap },
      deliveredPct: total ? +((delivered / total) * 100).toFixed(1) : 0,
      piecesInTransit,
      openExceptions: exceptions,
      revenueThisMonth: +monthInvoices.reduce((s, i) => s + Number(i.total), 0).toFixed(2),
      outstandingReceivables: +clients.reduce((s, c) => s + Number(c.outstandingBal), 0).toFixed(2),
      clientsOnHold: clients.filter((c) => c.isCreditHold).length,
      clientCount: clients.length,
      revenueTrend,
    };
  }
}
