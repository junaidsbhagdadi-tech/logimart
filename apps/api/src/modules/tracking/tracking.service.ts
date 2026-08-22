import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LIFECYCLE } from '../lifecycle/lifecycle.service';

const CODES = new Set<string>(LIFECYCLE.map((l) => l.code));
const labelOf = (c: string) => LIFECYCLE.find((l) => l.code === c)?.label ?? c;

/** Public, sanitized track-and-trace — no auth, no client/financial data. Milestone lifecycle. */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async track(awbRaw: string) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      include: { destHub: true, pieces: { select: { status: true } } },
    });
    if (!s) throw new NotFoundException('Shipment not found');

    // Public timeline = the milestone scan history (scanLog), excluding internal events (e.g. BAG).
    const logs = await this.prisma.scanLog.findMany({ where: { awb }, orderBy: { scanAt: 'asc' } });
    const timeline = logs
      .filter((l) => CODES.has(l.eventType))
      .map((l) => ({ checkpoint: l.eventType, label: labelOf(l.eventType), at: l.scanAt }));

    const delivered = s.pieces.filter((p) => p.status === 'DELIVERED').length;
    return {
      awb: s.awb,
      status: s.status,
      statusCode: s.statusCode ?? 'MAN',
      currentLabel: labelOf(String(s.statusCode ?? 'MAN')),
      destination: s.destHub.name,
      pieceCount: s.pieceCount,
      delivered,
      isShort: delivered > 0 && delivered < s.pieceCount,
      expectedDelivery: s.expectedDelivery,
      timeline,
    };
  }
}
