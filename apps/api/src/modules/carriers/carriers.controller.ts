import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { CarriersService } from './carriers.service';
import { ExceptionsService } from './exceptions.service';
import { ShipmentsService } from '../shipments/shipments.service';

const OPS = [UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN, UserRole.DRIVER];

@Controller('api/v1')
@UseGuards(RolesGuard)
export class CarriersController {
  constructor(private readonly carriers: CarriersService, private readonly exceptions: ExceptionsService, private readonly shipments: ShipmentsService) {}

  /** Hand the AWB to its own carrier (picked from the vendor code). */
  @Post('carriers/handoff/:awb')
  @Roles(...OPS)
  handoff(@Param('awb') awb: string) {
    return this.carriers.handoff(awb);
  }

  /** Cancel a booking — with its carrier first when it was handed off (BlueDart / Delhivery / XpressBees / Gati). */
  @Post('carriers/cancel/:awb')
  @Roles(...OPS, UserRole.FINANCE_EXEC)
  async cancel(@Param('awb') awb: string, @Body() dto: { reason?: string; force?: boolean }, @Req() req: any) {
    // A rider may cancel only their own booking that is still Booked (also after the carrier hand-off).
    if (req.user?.role === UserRole.DRIVER) await this.shipments.assertRiderCanCancel(awb, BigInt(req.user.sub));
    return this.carriers.cancelBooking(awb, String(dto?.reason || '').trim() || 'Cancelled', req.user?.sub ? BigInt(req.user.sub) : undefined, { force: !!dto?.force, isSuper: req.user?.role === UserRole.SYS_ADMIN });
  }

  /** Refresh the AWB's tracking from its carrier. */
  @Post('carriers/track/:awb')
  @Roles(...OPS, UserRole.FINANCE_EXEC)
  track(@Param('awb') awb: string) {
    return this.carriers.track(awb);
  }

  /** Carrier suggestion for a booking — price, live serviceability, transit days. */
  /** Track any carrier number — also ones never booked with us. Staff only. */
  @Get('carriers/lookup/:number')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SALES, UserRole.ADMIN, UserRole.SYS_ADMIN)
  lookup(@Param('number') number: string) {
    return this.carriers.lookup(number);
  }

  @Post('carriers/suggest')
  @Roles(...OPS, UserRole.FINANCE_EXEC, UserRole.SALES)
  suggest(@Body() dto: { clientId: number; product: string; originPincode?: string; destPincode: string; deadKg?: number; pcs?: number; declaredValue?: number; air?: boolean }) {
    return this.carriers.suggest({ ...dto, clientId: Number(dto.clientId) });
  }

  /** CS exceptions inbox. */
  @Get('exceptions')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.SALES)
  inbox(@Req() req: any) {
    return this.exceptions.inbox(req.user);
  }
}
