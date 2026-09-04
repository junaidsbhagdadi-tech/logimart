import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { DelhiveryService } from './delhivery.service';

@Controller('api/v1/delhivery')
@UseGuards(RolesGuard)
export class DelhiveryController {
  constructor(private readonly del: DelhiveryService) {}

  @Get('status')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  status() {
    return this.del.status();
  }

  @Get('serviceable/:pincode')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  serviceable(@Param('pincode') pincode: string) {
    return this.del.serviceability(pincode);
  }

  @Get('track/:awb')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  track(@Param('awb') awb: string) {
    return this.del.track(awb);
  }

  /** Hand a Logimart shipment off to Delhivery (create shipment / manifest). */
  @Post('handoff/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  handoff(@Param('awb') awb: string) {
    return this.del.createShipment(awb);
  }

  @Post('sync/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  sync(@Param('awb') awb: string) {
    return this.del.syncTracking(awb);
  }

  /** Cancel a Delhivery shipment (before pickup). */
  @Post('cancel/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  cancel(@Param('awb') awb: string) {
    return this.del.cancel(awb);
  }
}
