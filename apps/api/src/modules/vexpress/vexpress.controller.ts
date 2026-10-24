import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { VExpressService } from './vexpress.service';

@Controller('api/v1/vexpress')
@UseGuards(RolesGuard)
export class VExpressController {
  constructor(private readonly vx: VExpressService) {}

  @Get('status')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  status() {
    return this.vx.status();
  }

  /** Book the shipment with V Express (creates their LR). */
  @Post('handoff/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN, UserRole.DRIVER) // DRIVER: rider app hands its own bookings to the carrier
  handoff(@Param('awb') awb: string) {
    return this.vx.handoff(awb);
  }

  @Post('sync/:awb')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  sync(@Param('awb') awb: string) {
    return this.vx.syncTracking(awb);
  }

  /** Raw V Express record for one of their LR numbers. */
  @Get('lr/:number')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  lr(@Param('number') number: string) {
    return this.vx.lr(number);
  }
}
