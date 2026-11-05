import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Feature, Roles } from '../../common/rbac/roles.decorator';
import { scopedClientIds } from '../../common/scope/data-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { PerformanceService, PrioritySetting } from './performance.service';

const STAFF = [UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.WAREHOUSE_HANDLER, UserRole.SALES];

@Controller('api/v1')
@UseGuards(RolesGuard)
export class PerformanceController {
  constructor(private readonly perf: PerformanceService, private readonly prisma: PrismaService) {}

  /** Internal carrier / vendor-wise performance (+ patterns, trend, NDR). */
  @Get('performance')
  @Feature('/carrier-performance')
  @Roles(...STAFF)
  async internal(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('clientId') clientId?: string, @Query('vendor') vendor?: string) {
    const scope = await scopedClientIds(this.prisma, req.user);
    let ids: bigint[] | null = scope ?? null;
    if (clientId && /^\d+$/.test(clientId)) ids = scope ? (scope.includes(BigInt(clientId)) ? [BigInt(clientId)] : []) : [BigInt(clientId)];
    return this.perf.dashboard({ from, to, clientIds: ids, vendor: vendor?.trim() || undefined, internal: true });
  }

  /** Customer portal "Performance dashboard" — their own (and child) accounts, no carrier names. */
  @Get('portal/performance')
  @Roles(UserRole.CLIENT_ADMIN)
  async portal(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    // #14-4 only for customers switched on (Customers → edit → "Performance dashboard"), not by default.
    const c = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(req.user.clientId) }, select: { canSeePerformance: true } });
    if (!c?.canSeePerformance) throw new ForbiddenException('The Performance dashboard is not enabled for your account — ask your account manager.');
    const ids = await this.perf.portalClientIds(BigInt(req.user.clientId));
    return this.perf.dashboard({ from, to, clientIds: ids, internal: false });
  }

  @Get('performance/priority')
  @Feature('/carrier-performance')
  @Roles(...STAFF)
  priority() { return this.perf.getPriority(); }

  @Post('performance/priority')
  @Roles(UserRole.SYS_ADMIN, UserRole.HUB_MANAGER)
  setPriority(@Body() dto: Partial<PrioritySetting>) { return this.perf.setPriority(dto); }
}
