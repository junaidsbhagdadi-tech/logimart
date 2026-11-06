import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Milestones after which a delivery is no longer the rider's open task. */
const CLOSED = ['DLD', 'RTO', 'RTD', 'CAN'];

@Controller('api/v1/rider')
@UseGuards(RolesGuard)
@Roles(UserRole.DRIVER, UserRole.SYS_ADMIN)
export class RiderController {
  constructor(private readonly prisma: PrismaService) {}

  /** A rider's open pickups + deliveries (rider app home), plus today's done counts. */
  @Get('tasks')
  async tasks(@Req() req: any) {
    const riderId = BigInt(req.user.sub);
    // Master Rider ID: every rider's open work (+ unassigned pickups), each tagged with who holds it.
    const me = await this.prisma.user.findUnique({ where: { id: riderId }, select: { isMasterRider: true } });
    const master = !!me?.isMasterRider;
    // Start of today in IST, as a UTC instant.
    const ist = new Date(Date.now() + 330 * 60000);
    const dayStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60000);

    const reqs = await this.prisma.pickupRequest.findMany({
      where: master ? { status: { in: ['REQUESTED', 'ASSIGNED'] } } : { assignedRiderId: riderId, status: { in: ['ASSIGNED'] } },
      orderBy: { createdAt: 'asc' },
    });
    const clients = reqs.length
      ? await this.prisma.b2bClient.findMany({ where: { id: { in: [...new Set(reqs.map((p) => p.clientId))] } }, select: { id: true, legalName: true, accountCode: true } })
      : [];
    const cById = new Map(clients.map((c) => [String(c.id), c]));
    const riderIds = master ? [...new Set(reqs.map((p) => p.assignedRiderId).filter((x): x is bigint => x != null))] : [];
    const riderName = new Map<string, string>();
    const tag = (id: bigint | null | undefined) => (!master ? '' : id == null ? ' [unassigned]' : id === riderId ? '' : ` [${riderName.get(String(id)) || 'rider'}]`);
    const pickups0 = reqs;
    const pickups = () => pickups0.map((p) => ({
      ...p,
      customerName: (cById.get(String(p.clientId))?.legalName ?? '') + tag(p.assignedRiderId) || null,
      accountCode: cById.get(String(p.clientId))?.accountCode ?? null,
    }));

    // Open deliveries the rider owns (assigned by ops, or taken out via an OFD scan in the app).
    const shipments = await this.prisma.shipment.findMany({
      where: { deliveryRiderId: master ? { not: null } : riderId, OR: [{ statusCode: null }, { statusCode: { notIn: CLOSED } }] },
      include: { pieces: { select: { status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (master) {
      const ids = [...new Set([...riderIds, ...shipments.map((s) => s.deliveryRiderId).filter((x): x is bigint => x != null)])];
      const rs = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, riderCode: true } }) : [];
      rs.forEach((r) => riderName.set(String(r.id), `${r.fullName}${r.riderCode ? ' ' + r.riderCode : ''}`));
    }
    const deliveries = shipments.map((s) => ({
      awb: s.awb,
      status: s.status,
      statusCode: s.statusCode || 'MAN',
      consigneeName: (s.consigneeName ?? '') + tag(s.deliveryRiderId),
      consigneePhone: s.consigneePhone,
      address: [s.consigneeAddress, s.consigneeCity, s.destPincode].filter(Boolean).join(', ') || '—',
      pieceCount: s.pieceCount,
      delivered: s.pieces.filter((p) => p.status === 'DELIVERED').length,
      toPay: s.paymentTerm === 'TO_PAY' && !s.freightCollectedAt,
      dodPending: s.isDod && !s.dodCollectedAt,
    }));

    const [picked, delivered] = await Promise.all([
      this.prisma.scanLog.count({ where: { ...(master ? {} : { scannedById: riderId }), eventType: 'PKD', scanAt: { gte: dayStart } } }),
      this.prisma.scanLog.count({ where: { ...(master ? {} : { scannedById: riderId }), eventType: 'DLD', scanAt: { gte: dayStart } } }),
    ]);

    return { pickups: pickups(), deliveries, today: { picked, delivered } };
  }
}
