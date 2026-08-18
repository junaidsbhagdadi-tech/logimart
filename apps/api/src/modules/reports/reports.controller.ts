import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ReportsService } from './reports.service';

@Controller('api/v1/reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get(':type')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  run(@Param('type') type: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.run(type, from, to);
  }
}
