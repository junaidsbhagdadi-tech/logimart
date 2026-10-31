import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ReportsService } from './reports.service';
import { CustomerMisService } from './customer-mis.service';
import { DailySummaryService } from './daily-summary.service';

@Controller('api/v1/reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService, private readonly mis: CustomerMisService, private readonly summary: DailySummaryService) {}

  /** End-of-day summary mails (DEL / BOM / All-India) — send now, or {dry:true} to preview the numbers. */
  @Post('daily-summary/send')
  @Roles(UserRole.SYS_ADMIN)
  dailySummary(@Body() dto: { scope?: 'DEL' | 'BOM' | 'ALL'; dry?: boolean }) {
    return this.summary.sendAll({ scope: dto?.scope, dry: !!dto?.dry });
  }

  /** Customer MIS (Excel) for one customer — what tomorrow's 9 AM email will carry. */
  @Get('customer-mis/:clientId.xlsx')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.WAREHOUSE_HANDLER)
  async misXlsx(@Param('clientId') clientId: string, @Res() res: any) {
    const rows = await this.mis.rows(BigInt(clientId));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="MIS_${clientId}.xlsx"`);
    res.send(this.mis.xlsx(rows));
  }

  @Get('customer-mis/:clientId.csv')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.WAREHOUSE_HANDLER)
  async misCsv(@Param('clientId') clientId: string, @Res() res: any) {
    const rows = await this.mis.rows(BigInt(clientId));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="MIS_${clientId}.csv"`);
    res.send(this.mis.csv(rows));
  }

  /** Send one customer's MIS now — to `to` (preview, internal) or, without it, to the customer + CC. */
  @Post('customer-mis/:clientId/send')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  sendMis(@Param('clientId') clientId: string, @Query('to') to?: string) {
    return this.mis.sendFor(BigInt(clientId), to);
  }

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

  /** Data-completeness check — master-data gaps that break booking/pricing. Declared before :type. */
  @Get('data-health')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  dataHealth() {
    return this.svc.dataHealth();
  }

  @Get(':type')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  run(@Param('type') type: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.run(type, from, to);
  }
}
