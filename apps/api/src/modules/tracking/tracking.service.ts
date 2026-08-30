import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LIFECYCLE } from '../lifecycle/lifecycle.service';

const CODES = new Set<string>(LIFECYCLE.map((l) => l.code));
const labelOf = (c: string) => LIFECYCLE.find((l) => l.code === c)?.label ?? c;

/** Public, sanitized track-and-trace — no auth, no client/financial data. Milestone lifecycle. */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bulk track — compact status for many AWBs at once (unknown ones flagged found:false). */
  async trackMany(awbsRaw: string[]) {
    const awbs = [...new Set((awbsRaw || []).map((a) => String(a || '').trim().toUpperCase()).filter(Boolean))].slice(0, 300);
    if (!awbs.length) return [];
    // Match each pasted value against our AWB OR the forwarding-no / customer reference / LR number,
    // so a mixed paste of any of those numbers still resolves.
    const ships = await this.prisma.shipment.findMany({
      where: { OR: [
        { awb: { in: awbs } },
        { forwardingAwb: { in: awbs, mode: 'insensitive' } },
        { referenceNo: { in: awbs, mode: 'insensitive' } },
        { lrNumber: { in: awbs, mode: 'insensitive' } },
      ] },
      include: { destHub: { select: { name: true } }, pieces: { select: { status: true } } },
    });
    // Index by every key a paste could have used.
    const byAwb = new Map<string, typeof ships[number]>();
    for (const s of ships) for (const k of [s.awb, s.forwardingAwb, s.referenceNo, s.lrNumber]) if (k) byAwb.set(String(k).toUpperCase(), s);
    return awbs.map((awb) => {
      const s = byAwb.get(awb);
      if (!s) return { awb, found: false };
      const delivered = s.pieces.filter((p) => p.status === 'DELIVERED').length;
      return {
        awb: s.awb, found: true, statusCode: s.statusCode ?? 'MAN',
        currentLabel: labelOf(String(s.statusCode ?? 'MAN')), status: s.status,
        destination: s.destHub?.name ?? s.consigneeCity ?? s.destZone,
        consignee: s.consigneeName ?? null, pieceCount: s.pieceCount, delivered,
        expectedDelivery: s.expectedDelivery ?? null, forwardingAwb: s.forwardingAwb ?? null,
      };
    });
  }

  async track(awbRaw: string) {
    const key = String(awbRaw || '').trim();
    const awbU = key.toUpperCase();
    // Resolve by our AWB first, then by the carrier forwarding-no or the customer's own reference /
    // order-id (referenceNo / lrNumber) so customers can track by the number they know.
    const s =
      (await this.prisma.shipment.findUnique({ where: { awb: awbU }, include: { destHub: true, pieces: { select: { status: true } } } })) ??
      (await this.prisma.shipment.findFirst({
        where: { OR: [
          { forwardingAwb: { equals: key, mode: 'insensitive' } },
          { referenceNo: { equals: key, mode: 'insensitive' } },
          { lrNumber: { equals: key, mode: 'insensitive' } },
        ] },
        include: { destHub: true, pieces: { select: { status: true } } },
        orderBy: { createdAt: 'desc' },
      }));
    if (!s) throw new NotFoundException('Shipment not found');
    const awb = s.awb;

    // Public timeline = the milestone scan history (scanLog), excluding internal events (e.g. BAG).
    const logs = await this.prisma.scanLog.findMany({ where: { awb }, orderBy: { scanAt: 'asc' } });
    const timeline = logs
      .filter((l) => CODES.has(l.eventType))
      .map((l) => ({ checkpoint: l.eventType, label: labelOf(l.eventType), at: l.scanAt }));

    const delivered = s.pieces.filter((p) => p.status === 'DELIVERED').length;
    // EDD fallback for legacy shipments booked before the promise date was stored.
    const eddFallback = () => {
      const surface = /SURFACE|ROAD|RAIL/i.test(String(s.serviceMode)) || ['SURFACE', 'HUB'].includes(String(s.product ?? '').toUpperCase());
      const sameZone = String(s.originZone).toUpperCase() === String(s.destZone).toUpperCase();
      const base = new Date(s.createdAt); base.setHours(0, 0, 0, 0);
      base.setDate(base.getDate() + (surface ? (sameZone ? 2 : 4) : (sameZone ? 1 : 2)));
      return base;
    };
    return {
      awb: s.awb,
      status: s.status,
      statusCode: s.statusCode ?? 'MAN',
      currentLabel: labelOf(String(s.statusCode ?? 'MAN')),
      destination: s.destHub?.name ?? s.consigneeCity ?? s.destZone,
      pieceCount: s.pieceCount,
      delivered,
      isShort: delivered > 0 && delivered < s.pieceCount,
      expectedDelivery: s.expectedDelivery ?? eddFallback(),
      timeline,
    };
  }
}
