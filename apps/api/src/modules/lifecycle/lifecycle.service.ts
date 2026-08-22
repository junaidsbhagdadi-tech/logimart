import { BadRequestException, Injectable } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Milestone lifecycle. Each scan advances the shipment's statusCode and mirrors the coarse
// ShipmentStatus enum (which existing screens/reports read).
export const LIFECYCLE = [
  { code: 'MAN', label: 'Manifested', mile: 'first' },
  { code: 'PKD', label: 'Picked', mile: 'first' },
  { code: 'ORD', label: 'Origin hub received', mile: 'mid' },
  { code: 'DPD', label: 'Departed origin', mile: 'mid' },
  { code: 'DRD', label: 'Destination received', mile: 'mid' },
  { code: 'OFD', label: 'Out for delivery', mile: 'last' },
  { code: 'DLD', label: 'Delivered', mile: 'last' },
  { code: 'UDL', label: 'Undelivered', mile: 'last' },
  { code: 'RTO', label: 'Return to Origin', mile: 'last' },
  { code: 'RTD', label: 'Return Delivered', mile: 'last' },
  { code: 'CAN', label: 'Cancelled', mile: 'last' },
] as const;
const CODES = new Set<string>(LIFECYCLE.map((l) => l.code));
// Allowed forward transitions. MAN is set at booking; CAN only from MAN (pickup cancelled).
// Terminal states (DLD/RTD/CAN) have no next. A super admin may override any transition.
const NEXT: Record<string, string[]> = {
  MAN: ['PKD', 'CAN'],
  PKD: ['ORD'],
  ORD: ['DPD'],
  DPD: ['DRD'],
  DRD: ['OFD'],
  OFD: ['DLD', 'UDL'],
  UDL: ['OFD', 'RTO'],
  RTO: ['RTD'],
  DLD: [], RTD: [], CAN: [],
};
const TO_ENUM: Record<string, ShipmentStatus> = {
  MAN: ShipmentStatus.CREATED, PKD: ShipmentStatus.PICKED_UP, ORD: ShipmentStatus.AT_HUB,
  DPD: ShipmentStatus.IN_TRANSIT, DRD: ShipmentStatus.AT_HUB, OFD: ShipmentStatus.OUT_FOR_DELIVERY,
  DLD: ShipmentStatus.DELIVERED, UDL: ShipmentStatus.EXCEPTION,
  RTO: ShipmentStatus.IN_TRANSIT, RTD: ShipmentStatus.DELIVERED, CAN: ShipmentStatus.CANCELLED,
};

@Injectable()
export class LifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record a milestone scan for one or more AWBs. DLD requires a POD image. Terminal states
   *  (DLD/RTD/CAN) are locked once set — only a super admin can move a shipment off them. */
  async scan(dto: { awbs: string[]; code: string; hubId?: number; remark?: string; podDataUrl?: string; bagCode?: string }, userId?: bigint, role?: string) {
    const code = String(dto.code || '').trim().toUpperCase();
    if (!CODES.has(code)) throw new BadRequestException(`Unknown status code ${code}.`);
    const awbs = (dto.awbs || []).map((a) => String(a).trim().toUpperCase()).filter(Boolean);
    if (!awbs.length) throw new BadRequestException('No AWB scanned.');
    if (code === 'DLD' && !dto.podDataUrl) throw new BadRequestException('POD image is mandatory to mark Delivered.');
    const isSuper = String(role || '').toUpperCase() === 'SYS_ADMIN';

    const done: string[] = []; const missing: string[] = []; const locked: string[] = [];
    for (const awb of awbs) {
      const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, statusCode: true } });
      if (!s) { missing.push(awb); continue; }
      const current = String(s.statusCode || 'MAN').toUpperCase();
      // Enforce the sequence for everyone but super admins. Re-scanning the same status is a no-op-ish
      // allowed idempotent scan; any other move must be a permitted next step.
      if (code !== current && !isSuper && !(NEXT[current] ?? []).includes(code)) { locked.push(awb); continue; }
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: {
          statusCode: code, statusAt: new Date(), status: TO_ENUM[code],
          ...(code === 'DLD' && dto.podDataUrl ? { podUrl: dto.podDataUrl } : {}),
          ...(dto.bagCode ? { bagCode: dto.bagCode } : {}),
          ...(['UDL', 'RTO', 'CAN'].includes(code) ? { exceptionFlag: dto.remark || code } : {}),
        },
      });
      await this.prisma.scanLog.create({ data: { awb, eventType: code, remark: dto.remark || null, scannedById: userId ?? null } });
      done.push(awb);
    }
    return { code, updated: done.length, done, missing, locked };
  }

  /** Full scan timeline for one AWB (append-only history), oldest → newest, with labels.
   *  Consumable by staff, customer panel, and public website tracking. */
  async track(awbRaw: string) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const [shipment, logs] = await Promise.all([
      this.prisma.shipment.findUnique({
        where: { awb },
        select: { awb: true, statusCode: true, statusAt: true, originZone: true, destZone: true, consigneeName: true, consigneeCity: true, expectedDelivery: true, product: true, vendor: true },
      }),
      this.prisma.scanLog.findMany({ where: { awb }, orderBy: { scanAt: 'asc' } }),
    ]);
    if (!shipment) throw new BadRequestException(`AWB ${awb} not found.`);
    const labelOf = (c: string) => LIFECYCLE.find((l) => l.code === c)?.label || c;
    const timeline = logs.map((l) => ({ code: l.eventType, label: labelOf(l.eventType), at: l.scanAt, remark: l.remark }));
    return { ...shipment, currentLabel: labelOf(String(shipment.statusCode || 'MAN')), timeline };
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
