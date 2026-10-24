import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ArlService } from './arl.service';

@Controller('api/v1/arl')
@UseGuards(RolesGuard)
export class ArlController {
  constructor(private readonly arl: ArlService) {}

  @Get('status')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  status() {
    return this.arl.status();
  }

  @Post('handoff/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN, UserRole.DRIVER)
  handoff(@Param('awb') awb: string) {
    return this.arl.handoff(awb);
  }

  @Post('sync/:awb')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  sync(@Param('awb') awb: string) {
    return this.arl.syncTracking(awb);
  }

  @Get('track/:cn')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  track(@Param('cn') cn: string) {
    return this.arl.track(cn);
  }
}
