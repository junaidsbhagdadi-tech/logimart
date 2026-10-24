import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { XpressBeesService } from './xpressbees.service';

@Controller('api/v1/xpressbees')
@UseGuards(RolesGuard)
export class XpressBeesController {
  constructor(private readonly xb: XpressBeesService) {}

  /** Config + AWB-pool health (what's set, how many numbers are left). */
  @Get('status')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  status() {
    return this.xb.status();
  }

  /** Top up the AWB / box-id pool (XpressBees issues min 1,000 at a time). */
  @Post('refill')
  @Roles(UserRole.SYS_ADMIN)
  refill(@Body() dto: { kind?: 'AWB' | 'MPS'; routeMode?: 'Surface' | 'Air'; quantity?: number }) {
    return this.xb.refill(dto?.kind === 'MPS' ? 'MPS' : 'AWB', dto?.routeMode === 'Air' ? 'Air' : 'Surface', dto?.quantity ?? 1000);
  }

  /** Hand a Logimart shipment to XpressBees (manifest) — returns the XpressBees AWB. */
  @Post('handoff/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN, UserRole.DRIVER) // DRIVER: rider app hands its own bookings to the carrier
  handoff(@Param('awb') awb: string) {
    return this.xb.handoff(awb);
  }

  @Post('sync/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  sync(@Param('awb') awb: string) {
    return this.xb.syncTracking(awb);
  }

  @Post('cancel/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  cancel(@Param('awb') awb: string, @Req() req: any) {
    return this.xb.cancel(awb, req.user?.email || 'Logimart');
  }
}
