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

  /** Full scan timeline for one AWB (staff view; also feeds customer panel / website tracking).
   *  A CLIENT_ADMIN may track, but only their own account's AWBs (scoped in the service). */
  @Get('track/:awb')
  @Roles(...OPS, UserRole.CLIENT_ADMIN)
  track(@Param('awb') awb: string, @Req() req: any) {
    return this.svc.track(awb, req.user.role === UserRole.CLIENT_ADMIN && req.user.clientId != null ? BigInt(req.user.clientId) : undefined);
  }

  /** Rich tracking detail for the dedicated tracker page. CLIENT_ADMIN scoped to own AWBs. */
  @Get('detail/:awb')
  @Roles(...OPS, UserRole.CLIENT_ADMIN)
  detail(@Param('awb') awb: string, @Req() req: any) {
    return this.svc.trackDetail(awb, req.user.role === UserRole.CLIENT_ADMIN && req.user.clientId != null ? BigInt(req.user.clientId) : undefined);
  }

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
  csDashboard(@Query('from') from?: string, @Query('to') to?: string, @Query('vendor') vendor?: string, @Query('clientId') clientId?: string) {
    return this.svc.csDashboard(from, to, { vendor, clientId });
  }

  /** Operations dashboard — task buckets by stage (optionally one vendor / one customer). */
  @Get('ops-dashboard')
  @Roles(...OPS, UserRole.SALES)
  opsDashboard(@Query('vendor') vendor?: string, @Query('clientId') clientId?: string) { return this.svc.opsDashboard({ vendor, clientId }); }

  @Get('ops-bucket/:code')
  @Roles(...OPS, UserRole.SALES)
  opsBucket(@Param('code') code: string, @Query('vendor') vendor?: string, @Query('clientId') clientId?: string) {
    return this.svc.opsBucket(String(code).toUpperCase(), 2000, { vendor, clientId });
  }

  @Post('bag')
  @Roles(...OPS)
  bag(@Body() dto: { bagCode: string; awbs: string[] }, @Req() req: any) {
    return this.svc.bag(dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }
}
