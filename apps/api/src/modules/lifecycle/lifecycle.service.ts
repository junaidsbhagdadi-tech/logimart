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
  PKD: ['ORD', 'OFD'], // OFD = direct city-to-city (no hub); ORD = hub-routed
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
  async scan(dto: { awbs: string[]; code: string; hubId?: number; location?: string; remark?: string; podDataUrl?: string; bagCode?: string; scanAt?: string }, userId?: bigint, role?: string) {
    const code = String(dto.code || '').trim().toUpperCase();
    if (!CODES.has(code)) throw new BadRequestException(`Unknown status code ${code}.`);
    const awbs = (dto.awbs || []).map((a) => String(a).trim().toUpperCase()).filter(Boolean);
    if (!awbs.length) throw new BadRequestException('No AWB scanned.');
    if (code === 'DLD' && !dto.podDataUrl) throw new BadRequestException('POD image is mandatory to mark Delivered.');
    const isSuper = String(role || '').toUpperCase() === 'SYS_ADMIN';
    // Scan timestamp — the operator can back/forward-date the scan (else now).
    const at = dto.scanAt ? new Date(dto.scanAt) : new Date();

    // Auto bag-code helper: at PICKUP (PKD) group shipments heading to the same destination hub/zone
    // on the same day — e.g. "BOM-230826". Set only if the shipment isn't already bagged.
    const ymd = (() => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(2)}`; })();

    const done: string[] = []; const missing: string[] = []; const locked: string[] = []; const duplicate: string[] = [];
    for (const awb of awbs) {
      const s = await this.prisma.shipment.findUnique({
        where: { awb },
        select: { id: true, statusCode: true, bagCode: true, destZone: true, consigneeCity: true, destHub: { select: { code: true } } },
      });
      if (!s) { missing.push(awb); continue; }
      // Never record the same milestone twice for an AWB.
      const already = await this.prisma.scanLog.findFirst({ where: { awb, eventType: code }, select: { id: true } });
      if (already) { duplicate.push(awb); continue; }
      const current = String(s.statusCode || 'MAN').toUpperCase();
      // Enforce the sequence for everyone but super admins. Re-scanning the same status is a no-op-ish
      // allowed idempotent scan; any other move must be a permitted next step.
      if (code !== current && !isSuper && !(NEXT[current] ?? []).includes(code)) { locked.push(awb); continue; }
      // Derive a bag code at pickup when none exists (and the caller didn't pass one).
      let autoBag: string | undefined;
      if (code === 'PKD' && !dto.bagCode && !s.bagCode) {
        const dest = s.destHub?.code || (s.destZone ? String(s.destZone).toUpperCase() : '') || (s.consigneeCity ? String(s.consigneeCity).replace(/\s+/g, '').slice(0, 3).toUpperCase() : 'GEN');
        autoBag = `${dest}-${ymd}`;
      }
      await this.prisma.shipment.update({
        where: { id: s.id },
        data: {
          statusCode: code, statusAt: at, status: TO_ENUM[code],
          ...(code === 'DLD' && dto.podDataUrl ? { podUrl: dto.podDataUrl } : {}),
          ...(code === 'PKD' && dto.podDataUrl ? { pickupPodUrl: dto.podDataUrl } : {}),
          ...(dto.location ? { currentLocation: dto.location } : {}),
          ...(dto.bagCode ? { bagCode: dto.bagCode } : autoBag ? { bagCode: autoBag } : {}),
          ...(['UDL', 'RTO', 'CAN'].includes(code) ? { exceptionFlag: dto.remark || code } : {}),
        },
      });
      await this.prisma.scanLog.create({ data: { awb, eventType: code, scanAt: at, remark: dto.remark || null, serviceCenter: dto.location || null, scannedById: userId ?? null } });
      done.push(awb);
    }
    return { code, updated: done.length, done, missing, locked, duplicate };
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

  /** Rich tracking detail for the dedicated tracker page (header + milestone stepper + scan grid). */
  async trackDetail(awbRaw: string) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const labelOf = (c: string) => LIFECYCLE.find((l) => l.code === c)?.label || c;
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      include: {
        originHub: { select: { code: true, name: true } }, destHub: { select: { code: true, name: true } },
        client: { select: { legalName: true, accountCode: true } },
        pieces: { orderBy: { sequenceNo: 'asc' }, select: { childId: true, sequenceNo: true, deadKg: true, volKg: true, status: true, lengthCm: true, widthCm: true, heightCm: true } },
      },
    });
    if (!s) throw new BadRequestException(`AWB ${awb} not found.`);
    const logs = await this.prisma.scanLog.findMany({ where: { awb }, orderBy: { scanAt: 'desc' } });
    const userIds = [...new Set(logs.map((l) => l.scannedById).filter((x): x is bigint => !!x))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const uname = (id: bigint | null) => (id ? users.find((u) => u.id === id)?.fullName ?? null : null);
    const mile = logs.filter((l) => CODES.has(l.eventType));
    const riderOf = (...codes: string[]) => { for (const c of codes) { const l = mile.find((x) => x.eventType === c); if (l) return uname(l.scannedById); } return null; };
    const payMode = s.isDod ? 'DOD' : s.paymentTerm === 'TO_PAY' ? 'FOD' : 'PPD';
    const manAt = mile.find((l) => l.eventType === 'MAN')?.scanAt ?? s.createdAt;
    // EDD fallback for shipments booked before the promise date was stored: booking date + default TAT
    // (air 1 same-zone / 2 else; surface 2 / 4). Keeps the tracker's EDD populated for legacy AWBs.
    const eddFallback = () => {
      const surface = /SURFACE|ROAD|RAIL/i.test(String(s.serviceMode)) || ['SURFACE', 'HUB'].includes(String(s.product ?? '').toUpperCase());
      const sameZone = String(s.originZone).toUpperCase() === String(s.destZone).toUpperCase();
      const base = new Date(manAt); base.setHours(0, 0, 0, 0);
      base.setDate(base.getDate() + (surface ? (sameZone ? 2 : 4) : (sameZone ? 1 : 2)));
      return base;
    };

    return {
      awb: s.awb,
      forwardingAwb: s.forwardingAwb ?? null,
      vendor: s.vendor ?? null,
      payMode,
      customerName: (s as any).client?.legalName ?? null,
      accountCode: (s as any).client?.accountCode ?? null,
      originPincode: s.shipperPincode ?? null,
      destPincode: s.destPincode ?? null,
      shipper: s.shipperName ?? (s as any).client?.legalName ?? null,
      origin: [s.originLocation, s.originHub?.code].filter(Boolean).join(' - ') || s.originZone,
      destination: [s.consigneeCity, s.destHub?.code].filter(Boolean).join(' - ') || s.destZone,
      currentLocation: s.currentLocation ?? (s.destHub ? `${s.destHub.name} - ${s.destHub.code}` : null),
      orderDate: manAt,
      currentCode: s.statusCode ?? 'MAN',
      currentLabel: labelOf(String(s.statusCode ?? 'MAN')),
      remarks: s.exceptionFlag ?? null,
      edd: s.expectedDelivery ?? eddFallback(),
      shipmentValue: s.shipmentValue ?? s.declaredValue ?? null, // #9 visible on the tracker
      apptDelivery: s.apptDelivery, apptDate: s.apptDate ?? null,
      serviceType: s.product ?? s.service ?? null,
      tripRoute: [s.originHub?.code, s.destHub?.code].filter(Boolean).join(' → ') || null,
      pickupRider: riderOf('PKD'),
      deliveryRider: riderOf('OFD', 'DLD'),
      deliveryPod: s.podUrl ?? null,
      pickupPod: s.pickupPodUrl ?? null,
      consignee: {
        name: s.consigneeName, phone: s.consigneePhone, contact: (s as any).consigneeContact ?? null,
        address: s.consigneeAddress, city: s.consigneeCity, state: (s as any).consigneeState ?? null,
        pincode: s.destPincode, gstin: s.consigneeGstin ?? null,
      },
      shipperDetail: {
        name: s.shipperName ?? (s as any).client?.legalName ?? null, contact: (s as any).shipperContact ?? null,
        address: [s.shipperAddress1, s.shipperAddress2].filter(Boolean).join(', ') || null,
        city: s.shipperCity, state: s.shipperState, pincode: s.shipperPincode,
        phone: s.shipperPhone, mobile: s.shipperMobile, gstin: s.shipperGstin ?? (s as any).consignorGstin ?? null, email: s.shipperEmail,
      },
      pieces: s.pieces,
      scans: logs.map((l) => ({ at: l.scanAt, code: l.eventType, label: labelOf(l.eventType), location: l.serviceCenter ?? null, by: uname(l.scannedById), reason: ['UDL', 'RTO', 'CAN'].includes(l.eventType) ? l.remark : null, remark: l.remark })),
    };
  }

  /** Super-admin: wipe a shipment's scan history and reset it to MAN (undo test/erroneous scans). */
  async reset(awbRaw: string) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found.`);
    await this.prisma.scanLog.deleteMany({ where: { awb } });
    await this.prisma.shipment.update({ where: { id: s.id }, data: { statusCode: 'MAN', status: ShipmentStatus.CREATED, statusAt: new Date(), podUrl: null, exceptionFlag: null } });
    await this.prisma.scanLog.create({ data: { awb, eventType: 'MAN', remark: 'Reset' } });
    return { awb, reset: true };
  }

  /** Set / update the appointment delivery date. Reflected in the tracker's Remarks + Appointment field. */
  async setAppointment(awbRaw: string, dto: { date?: string; note?: string }) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found.`);
    const date = dto.date ? new Date(dto.date) : null;
    // yyyy-mm-ddThh:mm → dd/mm/yyyy HH:mm (24hr)
    const label = dto.date ? (() => { const [dp, tp] = String(dto.date).split('T'); const dmy = dp.split('-').reverse().join('/'); return tp ? `${dmy} ${tp.slice(0, 5)}` : dmy; })() : '';
    const remark = date ? `Appointment: ${label}${dto.note ? ' — ' + dto.note : ''}` : (dto.note || null);
    await this.prisma.shipment.update({
      where: { id: s.id },
      data: { apptDelivery: date != null, apptDate: date, exceptionFlag: remark },
    });
    return { ok: true, awb, apptDate: date, remark };
  }

  /** Upcoming appointment deliveries (today onward) — customer + date + AWB, for the global notification. */
  async upcomingAppointments() {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const rows = await this.prisma.shipment.findMany({
      where: { apptDelivery: true, apptDate: { gte: from }, statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } },
      orderBy: { apptDate: 'asc' }, take: 200,
      select: { awb: true, apptDate: true, consigneeName: true, consigneeCity: true, destZone: true, statusCode: true, client: { select: { legalName: true, accountCode: true } } },
    });
    return rows.map((r) => ({
      awb: r.awb, apptDate: r.apptDate,
      customer: r.client?.legalName ?? null, accountCode: r.client?.accountCode ?? null,
      consignee: r.consigneeName ?? null, destination: r.consigneeCity ?? r.destZone ?? null, statusCode: r.statusCode,
    }));
  }

  /** Customer-Service dashboard: pending / stuck shipments with aging, NDR (undelivered) + overdue flags. */
  async csDashboard(from?: string, to?: string) {
    const gte = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const lte = to ? new Date(`${to}T23:59:59`) : new Date();
    const labelOf = (c: string) => LIFECYCLE.find((l) => l.code === c)?.label || c;
    const ships = await this.prisma.shipment.findMany({
      where: { createdAt: { gte, lte }, statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } },
      orderBy: { createdAt: 'asc' }, take: 1500,
      select: { awb: true, statusCode: true, statusAt: true, createdAt: true, consigneeName: true, consigneePhone: true, consigneeCity: true, destZone: true, expectedDelivery: true, exceptionFlag: true, client: { select: { legalName: true, accountCode: true } } },
    });
    const now = Date.now();
    const rows = ships.map((s) => {
      const code = String(s.statusCode || 'MAN');
      const edd = s.expectedDelivery ? new Date(s.expectedDelivery).getTime() : null;
      return {
        awb: s.awb, customer: s.client?.legalName ?? '', code: s.client?.accountCode ?? '',
        consignee: s.consigneeName ?? '', phone: s.consigneePhone ?? '', destination: s.consigneeCity ?? s.destZone ?? '',
        statusCode: code, status: labelOf(code),
        ageDays: Math.floor((now - new Date(s.createdAt).getTime()) / 86400000),
        edd: s.expectedDelivery ?? null, overdue: !!edd && now > edd,
        ndr: code === 'UDL', remark: s.exceptionFlag ?? null,
      };
    });
    return { count: rows.length, ndrCount: rows.filter((r) => r.ndr).length, overdueCount: rows.filter((r) => r.overdue).length, rows };
  }

  /** Operations dashboard: task buckets by milestone stage (with counts). */
  async opsDashboard() {
    const grouped = await this.prisma.shipment.groupBy({ by: ['statusCode'], _count: { _all: true } });
    const c: Record<string, number> = {};
    for (const g of grouped) c[String(g.statusCode || 'MAN')] = g._count._all;
    return {
      buckets: [
        { key: 'MAN', label: 'Awaiting pickup', count: c.MAN || 0 },
        { key: 'PKD', label: 'Picked (to origin hub)', count: c.PKD || 0 },
        { key: 'ORD', label: 'At origin hub', count: c.ORD || 0 },
        { key: 'DPD', label: 'In transit', count: c.DPD || 0 },
        { key: 'DRD', label: 'At destination hub', count: c.DRD || 0 },
        { key: 'OFD', label: 'Out for delivery', count: c.OFD || 0 },
        { key: 'UDL', label: 'Undelivered (NDR)', count: c.UDL || 0 },
        { key: 'RTO', label: 'RTO', count: (c.RTO || 0) + (c.RTD || 0) },
      ],
      byCode: c,
    };
  }

  /** Shipments in one milestone bucket (drill-down for the ops dashboard). */
  async opsBucket(code: string, limit = 300) {
    const labelOf = (x: string) => LIFECYCLE.find((l) => l.code === x)?.label || x;
    const ships = await this.prisma.shipment.findMany({
      where: { statusCode: code === 'RTO' ? { in: ['RTO', 'RTD'] } : code },
      orderBy: { statusAt: 'asc' }, take: limit,
      select: { awb: true, statusCode: true, statusAt: true, consigneeCity: true, destZone: true, currentLocation: true, client: { select: { legalName: true } } },
    });
    return ships.map((s) => ({ awb: s.awb, customer: s.client?.legalName ?? '', destination: s.consigneeCity ?? s.destZone ?? '', at: s.statusAt, location: s.currentLocation ?? '', status: labelOf(String(s.statusCode || 'MAN')) }));
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
