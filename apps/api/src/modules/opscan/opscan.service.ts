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
  async record(dto: { awb: string; eventType: string; serviceCenter?: string; remark?: string; notifyCustomer?: boolean }, userId?: bigint) {
    const awb = (dto.awb || '').trim().toUpperCase();
    // A CS comment flagged for the customer is pushed to their portal as a popup until they read / reply.
    if (dto.eventType === 'COMMENT' && dto.notifyCustomer && dto.remark?.trim()) {
      await this.prisma.shipment.updateMany({ where: { awb }, data: { csComment: dto.remark.trim(), csCommentAt: new Date(), csCommentReadAt: null } });
    }
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

  /** Recent scans; a #10 branch/company-scoped user only sees scans of their customers' AWBs. */
  async list(limit = 50, scope?: bigint[] | null) {
    const take = Math.min(limit, 200);
    if (!scope) return this.prisma.scanLog.findMany({ orderBy: { scanAt: 'desc' }, take });
    // scan_logs has no clientId — join through shipments by AWB.
    if (!scope.length) return [];
    return this.prisma.$queryRaw`SELECT l.* FROM scan_logs l JOIN shipments s ON s.awb = l.awb
      WHERE s."clientId" = ANY(${scope}::bigint[]) ORDER BY l."scanAt" DESC LIMIT ${take}`;
  }
}
