import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ShipmentsService } from './shipments.service';
import { LabelsService } from '../labels/labels.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@Controller('api/v1/shipments')
@UseGuards(RolesGuard)
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly labels: LabelsService,
  ) {}

  @Post()
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(@Body() dto: CreateShipmentDto) {
    return this.shipments.create(dto);
  }

  /** List recent shipments. Client admins see only their own; staff see all. */
  @Get()
  list(@Req() req: any, @Query('limit') limit?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? BigInt(req.user.clientId) : undefined;
    return this.shipments.list(clientId, limit ? Number(limit) : 50);
  }

  @Get(':awb')
  findByAwb(@Param('awb') awb: string) {
    return this.shipments.findByAwb(awb);
  }

  /** Assign a rider for last-mile delivery. */
  @Post(':awb/assign-delivery')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  assignDelivery(@Param('awb') awb: string, @Body() dto: { riderId: number }) {
    return this.shipments.assignDelivery(awb, dto.riderId);
  }

  /** Rider marks Out For Delivery. */
  @Post(':awb/ofd')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  ofd(@Param('awb') awb: string, @Req() req: any) {
    return this.shipments.markOfd(awb, BigInt(req.user.sub));
  }

  /** Re-weigh at hub → raises a debit note for any freight delta. */
  @Post(':awb/reweigh')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  reweigh(
    @Param('awb') awb: string,
    @Body() dto: { lines: { sequenceNo: number; actualKg: number; lengthCm?: number; widthCm?: number; heightCm?: number }[] },
    @Req() req: any,
  ) {
    return this.shipments.reweigh(awb, dto.lines, req.user?.sub ? Number(req.user.sub) : undefined);
  }

  /** MPS labels for every child box. ?format=zpl | json (default json). */
  @Get(':awb/print-mps-labels')
  async labelsForAwb(@Param('awb') awb: string) {
    return this.labels.buildForAwb(awb);
  }
}
