import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [byStatus, total, exceptions, clients, monthInvoices, piecesInTransit] = await Promise.all([
      this.prisma.shipment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.shipment.count(),
      this.prisma.shipment.count({ where: { status: { in: ['EXCEPTION', 'PARTIAL'] } } }),
      this.prisma.b2bClient.findMany({ select: { outstandingBal: true, isCreditHold: true } }),
      this.prisma.invoice.findMany({
        where: { issuedAt: { gte: monthStart } },
        select: { total: true },
      }),
      this.prisma.shipmentPiece.count({ where: { status: { in: ['LOADED', 'IN_TRANSIT'] } } }),
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
    };
  }
}
