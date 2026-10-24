import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { DsCargoService } from './dscargo.service';

@Controller('api/v1/dscargo')
@UseGuards(RolesGuard)
export class DsCargoController {
  constructor(private readonly ds: DsCargoService) {}

  /** Raw DS Cargo record for a docket. */
  @Get('track/:docket')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.DRIVER)
  track(@Param('docket') docket: string) {
    return this.ds.track(docket);
  }

  /** Pull the DS Cargo status onto our AWB. */
  @Post('sync/:awb')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.DRIVER)
  sync(@Param('awb') awb: string) {
    return this.ds.syncTracking(awb);
  }
}
