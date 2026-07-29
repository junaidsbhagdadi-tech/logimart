import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/v1/rider')
@UseGuards(RolesGuard)
@Roles(UserRole.DRIVER, UserRole.SYS_ADMIN)
export class RiderController {
  constructor(private readonly prisma: PrismaService) {}

  /** A rider's assigned pickups + deliveries for the day. */
  @Get('tasks')
  async tasks(@Req() req: any) {
    const riderId = BigInt(req.user.sub);

    const pickups = await this.prisma.pickupRequest.findMany({
      where: { assignedRiderId: riderId, status: { in: ['ASSIGNED'] } },
      orderBy: { createdAt: 'desc' },
    });

    const shipments = await this.prisma.shipment.findMany({
      where: {
        deliveryRiderId: riderId,
        status: { in: ['AT_HUB', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'PARTIAL'] },
      },
      include: { pieces: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const deliveries = shipments.map((s) => ({
      awb: s.awb,
      status: s.status,
      consigneeName: s.consigneeName,
      consigneePhone: s.consigneePhone,
      address: [s.consigneeAddress, s.consigneeCity, s.destPincode].filter(Boolean).join(', ') || '—',
      pieceCount: s.pieceCount,
      delivered: s.pieces.filter((p) => p.status === 'DELIVERED').length,
    }));

    return { pickups, deliveries };
  }
}
