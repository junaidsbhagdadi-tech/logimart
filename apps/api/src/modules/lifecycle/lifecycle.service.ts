import { BadRequestException, Injectable } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Milestone lifecycle. Each scan advances the shipment's statusCode and mirrors the coarse
// ShipmentStatus enum (which existing screens/reports read).
export const LIFECYCLE = [
  { code: 'MAN', label: 'Manifested', mile: 'first' },
  { code: 'PKD', label: 'Picked', mile: 'first' },
  { code: 'ORD', label: 'Origin hub received', mile: 'first' },
  { code: 'DPD', label: 'Departed origin', mile: 'mid' },
  { code: 'DRD', label: 'Destination received', mile: 'mid' },
  { code: 'OFD', label: 'Out for delivery', mile: 'last' },
  { code: 'DLD', label: 'Delivered', mile: 'last' },
  { code: 'UDL', label: 'Undelivered', mile: 'last' },
] as const;
const CODES = new Set<string>(LIFECYCLE.map((l) => l.code));
const TO_ENUM: Record<string, ShipmentStatus> = {
  MAN: ShipmentStatus.CREATED, PKD: ShipmentStatus.PICKED_UP, ORD: ShipmentStatus.AT_HUB,
  DPD: ShipmentStatus.IN_TRANSIT, DRD: ShipmentStatus.AT_HUB, OFD: ShipmentStatus.OUT_FOR_DELIVERY,
  DLD: ShipmentStatus.DELIVERED, UDL: ShipmentStatus.EXCEPTION,
};

@Injectable()
export class LifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record a milestone scan for one or more AWBs. DLD requires a POD image. */
  async scan(dto: { awbs: string[]; code: string; hubId?: number; remark?: string; podDataUrl?: string; bagCode?: string }, userId?: bigint) {
    const code = String(dto.code || '').trim().toUpperCase();
    if (!CODES.has(code)) throw new BadRequestException(`Unknown status code ${code}.`);
    const awbs = (dto.awbs || []).map((a) => String(a).trim().toUpperCase()).filter(Boolean);
    if (!awbs.length) throw new BadRequestException('No AWB scanned.');
    if (code === 'DLD' && !dto.podDataUrl) throw new BadRequestException('POD image is mandatory to mark Delivered.');

    const done: string[] = []; const missing: string[] = [];
    for (const awb of awbs) {
      const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true } });
      if (!s) { missing.push(awb); continue; }
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: {
          statusCode: code, statusAt: new Date(), status: TO_ENUM[code],
          ...(code === 'DLD' && dto.podDataUrl ? { podUrl: dto.podDataUrl } : {}),
          ...(dto.bagCode ? { bagCode: dto.bagCode } : {}),
          ...(code === 'UDL' ? { exceptionFlag: dto.remark || 'UNDELIVERED' } : {}),
        },
      });
      await this.prisma.scanLog.create({ data: { awb, eventType: code, remark: dto.remark || null, scannedById: userId ?? null } });
      done.push(awb);
    }
    return { code, updated: done.length, done, missing };
  }

  /** Counts by milestone code (for the mile dashboards). */
  async summary() {
    const rows = await this.prisma.shipment.groupBy({ by: ['statusCode'], _count: { _all: true } });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.statusCode || 'MAN'] = r._count._all;
    return { counts, lifecycle: LIFECYCLE };
  }

  /** Shipments currently at a given milestone (dashboard drill-down / worklists). */
  async list(code?: string, limit = 100) {
    const where = code ? { statusCode: String(code).trim().toUpperCase() } : {};
    return this.prisma.shipment.findMany({
      where, orderBy: { statusAt: 'desc' }, take: Math.min(limit, 300),
      select: { awb: true, statusCode: true, statusAt: true, originZone: true, destZone: true, destPincode: true, consigneeName: true, consigneeCity: true, vendor: true, bagCode: true, product: true },
    });
  }

  /** Bag AWBs together (mid-mile). Assigns the bag code; returns how many bagged. */
  async bag(dto: { bagCode: string; awbs: string[] }, userId?: bigint) {
    const bagCode = String(dto.bagCode || '').trim().toUpperCase();
    if (!bagCode) throw new BadRequestException('Bag code required.');
    const awbs = (dto.awbs || []).map((a) => String(a).trim().toUpperCase()).filter(Boolean);
    let n = 0;
    for (const awb of awbs) {
      const r = await this.prisma.shipment.updateMany({ where: { awb }, data: { bagCode } });
      if (r.count) { n++; await this.prisma.scanLog.create({ data: { awb, eventType: 'BAG', remark: bagCode, scannedById: userId ?? null } }); }
    }
    return { bagCode, bagged: n };
  }

  /** Open bags = distinct bag codes with a count of shipments not yet destination-received. */
  async bags() {
    const rows = await this.prisma.shipment.groupBy({
      by: ['bagCode'], where: { bagCode: { not: null } }, _count: { _all: true },
    });
    return rows.filter((r) => r.bagCode).map((r) => ({ bagCode: r.bagCode, shipments: r._count._all }));
  }
}
