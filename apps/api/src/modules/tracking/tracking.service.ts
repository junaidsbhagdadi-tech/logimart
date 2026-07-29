import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const CHECKPOINT_LABEL: Record<string, string> = {
  PICKUP: 'Picked up',
  HUB_IN: 'Arrived at hub',
  HUB_OUT: 'Departed hub',
  LOAD: 'Loaded on vehicle',
  UNLOAD: 'Unloaded',
  DELIVERY: 'Delivered',
  POD: 'Proof of delivery captured',
};

/** Public, sanitized track-and-trace — no auth, no client/financial data. */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async track(awb: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      include: {
        destHub: true,
        pieces: { select: { id: true, status: true } },
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');

    const pieceIds = s.pieces.map((p) => p.id);
    const scans = await this.prisma.scanEvent.findMany({
      where: { pieceId: { in: pieceIds } },
      orderBy: { scannedAt: 'asc' },
      select: { checkpoint: true, scannedAt: true, hubId: true },
    });

    // earliest occurrence of each checkpoint forms the public timeline
    const seen = new Map<string, Date>();
    for (const e of scans) {
      if (!seen.has(e.checkpoint)) seen.set(e.checkpoint, e.scannedAt);
    }
    const timeline = [...seen.entries()]
      .map(([checkpoint, at]) => ({ checkpoint, label: CHECKPOINT_LABEL[checkpoint] ?? checkpoint, at }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    const delivered = s.pieces.filter((p) => p.status === 'DELIVERED').length;
    return {
      awb: s.awb,
      status: s.status,
      destination: s.destHub.name,
      pieceCount: s.pieceCount,
      delivered,
      isShort: delivered > 0 && delivered < s.pieceCount,
      timeline,
    };
  }
}
