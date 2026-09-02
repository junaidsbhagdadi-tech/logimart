import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { LifecycleService } from './lifecycle.service';

const OPS = [UserRole.DRIVER, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN];

@Controller('api/v1/lifecycle')
@UseGuards(RolesGuard)
export class LifecycleController {
  constructor(private readonly svc: LifecycleService) {}

  @Get('summary')
  @Roles(...OPS)
  summary() { return this.svc.summary(); }

  @Get('list')
  @Roles(...OPS)
  list(@Query('code') code?: string, @Query('limit') limit?: string) { return this.svc.list(code, limit ? Number(limit) : 100); }

  /** Full scan timeline for one AWB (staff view; also feeds customer panel / website tracking). */
  @Get('track/:awb')
  @Roles(...OPS)
  track(@Param('awb') awb: string) { return this.svc.track(awb); }

  /** Rich tracking detail for the dedicated tracker page. */
  @Get('detail/:awb')
  @Roles(...OPS)
  detail(@Param('awb') awb: string) { return this.svc.trackDetail(awb); }

  /** Super-admin only: wipe a shipment's scan history and reset it to MAN. */
  @Post('reset/:awb')
  @Roles(UserRole.SYS_ADMIN)
  reset(@Param('awb') awb: string) { return this.svc.reset(awb); }

  @Get('bags')
  @Roles(...OPS)
  bags() { return this.svc.bags(); }

  @Post('scan')
  @Roles(...OPS)
  scan(@Body() dto: { awbs: string[]; code: string; hubId?: number; location?: string; remark?: string; podDataUrl?: string; bagCode?: string; scanAt?: string }, @Req() req: any) {
    return this.svc.scan(dto, req.user?.sub ? BigInt(req.user.sub) : undefined, req.user?.role);
  }

  /** Set / update the appointment delivery date for an AWB. */
  @Post('appointment/:awb')
  @Roles(...OPS)
  appointment(@Param('awb') awb: string, @Body() dto: { date?: string; note?: string }) {
    return this.svc.setAppointment(awb, dto);
  }

  /** Upcoming appointment deliveries — feeds the global notification. */
  @Get('appointments')
  @Roles(...OPS)
  appointments() { return this.svc.upcomingAppointments(); }

  /** #16 — customer remarks awaiting CS attention (feeds the CS prompt bell). */
  @Get('customer-requests')
  @Roles(...OPS, UserRole.SALES)
  customerRequests() { return this.svc.customerRequests(); }

  /** #16 — CS acknowledges a customer remark (clears it from the prompt). */
  @Post('customer-requests/:awb/ack')
  @Roles(...OPS, UserRole.SALES)
  ackCustomerRemark(@Param('awb') awb: string) { return this.svc.ackCustomerRemark(awb); }

  /** Customer-Service dashboard — pending/stuck shipments + NDR. */
  @Get('cs-dashboard')
  @Roles(...OPS, UserRole.SALES)
  csDashboard(@Query('from') from?: string, @Query('to') to?: string) { return this.svc.csDashboard(from, to); }

  /** Operations dashboard — task buckets by stage. */
  @Get('ops-dashboard')
  @Roles(...OPS, UserRole.SALES)
  opsDashboard() { return this.svc.opsDashboard(); }

  @Get('ops-bucket/:code')
  @Roles(...OPS)
  opsBucket(@Param('code') code: string) { return this.svc.opsBucket(String(code).toUpperCase()); }

  @Post('bag')
  @Roles(...OPS)
  bag(@Body() dto: { bagCode: string; awbs: string[] }, @Req() req: any) {
    return this.svc.bag(dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }
}
