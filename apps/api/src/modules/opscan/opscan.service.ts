import { Injectable } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const STATUS_MAP: Record<string, ShipmentStatus> = {
  PICKUP_IN: ShipmentStatus.PICKED_UP,
  OUT_SCAN: ShipmentStatus.IN_TRANSIT,
  MANIFEST_IN: ShipmentStatus.AT_HUB,
  UNDELIVERED: ShipmentStatus.EXCEPTION,
  MISROUTE: ShipmentStatus.EXCEPTION,
};

@Injectable()
export class OpscanService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record an operational scan (pickup-in, out-scan, manifest-in, undelivered, miss-route). */
  async record(dto: { awb: string; eventType: string; serviceCenter?: string; remark?: string }, userId?: bigint) {
    const awb = (dto.awb || '').trim().toUpperCase();
    const log = await this.prisma.scanLog.create({
      data: {
        awb,
        eventType: dto.eventType,
        serviceCenter: dto.serviceCenter || null,
        remark: dto.remark || null,
        scannedById: userId ?? null,
      },
    });
    // best-effort shipment status update
    const st = STATUS_MAP[dto.eventType];
    if (st) {
      const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true } });
      if (s) {
        await this.prisma.shipment.update({
          where: { id: s.id },
          data: { status: st, ...(st === ShipmentStatus.EXCEPTION ? { exceptionFlag: dto.eventType } : {}) },
        });
      }
    }
    return { ...log, shipmentUpdated: !!st };
  }

  list(limit = 50) {
    return this.prisma.scanLog.findMany({ orderBy: { scanAt: 'desc' }, take: Math.min(limit, 200) });
  }
}
