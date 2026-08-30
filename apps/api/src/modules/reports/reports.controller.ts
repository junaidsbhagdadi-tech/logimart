import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ReportsService } from './reports.service';

@Controller('api/v1/reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  /** Preview the daily NDR + MIS digest numbers. */
  @Get('daily-digest/preview')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  digestPreview() {
    return this.svc.dailyDigest();
  }

  /** Queue the daily NDR + MIS digest email to the configured recipients. */
  @Post('daily-digest')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  emailDigest() {
    return this.svc.emailDailyDigest();
  }

  @Get(':type')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  run(@Param('type') type: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.run(type, from, to);
  }
}
