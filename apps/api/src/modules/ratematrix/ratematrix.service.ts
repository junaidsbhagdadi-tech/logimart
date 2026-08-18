import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const dec = (n: any) => new Prisma.Decimal(n ?? 0);

@Injectable()
export class RateMatrixService {
  constructor(private readonly prisma: PrismaService) {}

  list(clientId?: number) {
    return this.prisma.clientRateSlab.findMany({
      where: clientId != null ? { clientId: BigInt(clientId) } : undefined,
      orderBy: [{ clientId: 'asc' }, { rateType: 'asc' }, { weight: 'asc' }],
      take: 2000,
    });
  }

  create(d: any) {
    return this.prisma.clientRateSlab.create({
      data: {
        clientId: d.clientId != null && d.clientId !== '' ? BigInt(d.clientId) : null,
        vendor: d.vendor || null,
        product: d.product || null,
        zone: d.zone || null,
        country: d.country || null,
        destination: d.destination || null,
        service: d.service || null,
        origin: d.origin || null,
        originZone: d.originZone || null,
        unit: d.unit || null,
        days: d.days != null && d.days !== '' ? Number(d.days) : null,
        rateType: d.rateType,
        weight: dec(d.weight),
        rate: dec(d.rate),
        fromDate: d.fromDate ? new Date(d.fromDate) : new Date(),
      },
    });
  }

  /** Bulk add slabs (one Add row → many weight/rate pairs). */
  async bulk(rows: any[]) {
    let ok = 0;
    for (const r of rows) { try { await this.create(r); ok++; } catch { /* skip bad row */ } }
    return { imported: ok, failed: rows.length - ok };
  }

  remove(id: number) {
    return this.prisma.clientRateSlab.delete({ where: { id: BigInt(id) } });
  }
}
