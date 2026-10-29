import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { StatsService } from './stats.service';
import { PrismaService } from '../../prisma/prisma.service';
import { scopedClientIds } from '../../common/scope/data-scope';

@Controller('api/v1/stats')
@UseGuards(RolesGuard)
export class StatsController {
  constructor(private readonly stats: StatsService, private readonly prisma: PrismaService) {}

  @Get('overview')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  async overview(@Req() req: any) {
    return this.stats.overview(await scopedClientIds(this.prisma, req.user));
  }

  /** Windowed KPIs for the multi-carrier Shipping Hub home. */
  @Get('hub')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  async hub(@Req() req: any, @Query('window') window?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN && req.user.clientId != null ? BigInt(req.user.clientId) : undefined;
    return this.stats.hubSummary((window as any) || '7d', clientId, clientId == null ? await scopedClientIds(this.prisma, req.user) : null);
  }

  /**
   * Login greeting (full-screen welcome) — a few of today's counts for whoever just signed in.
   * Customers see their own account; staff see their branch/company scope. Any logged-in role.
   */
  @Get('greeting')
  async greeting(@Req() req: any) {
    const u = req.user;
    const me = await this.prisma.user.findUnique({ where: { id: BigInt(u.sub) }, select: { fullName: true, createdAt: true } });
    const startIst = new Date(`${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)}T00:00:00+05:30`);
    const isClient = u.role === UserRole.CLIENT_ADMIN && u.clientId != null;
    const scope = isClient ? [BigInt(u.clientId)] : await scopedClientIds(this.prisma, u);
    const base: any = scope ? { clientId: { in: scope } } : {};
    const n = (where: any) => this.prisma.shipment.count({ where: { ...base, ...where } });
    const [bookedToday, ofd, inTransit, deliveredToday, exceptions] = await Promise.all([
      n({ createdAt: { gte: startIst }, NOT: { statusCode: 'CAN' } }),
      n({ statusCode: 'OFD', statusAt: { gte: new Date(Date.now() - 7 * 864e5) } }), // ignore long-stuck OFDs
      n({ statusCode: { in: ['PKD', 'ORD', 'DPD', 'DRD'] }, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } }),
      n({ statusCode: 'DLD', statusAt: { gte: startIst } }),
      isClient ? Promise.resolve(0) : n({ exceptionFlag: { not: null }, statusCode: { notIn: ['DLD', 'RTD', 'CAN'] }, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } }),
    ]);
    return {
      name: me?.fullName ?? null,
      isNew: !!me && Date.now() - +me.createdAt < 3 * 864e5, // account made in the last 3 days → "Welcome to Logimart"
      isClient,
      counts: { bookedToday, ofd, inTransit, deliveredToday, exceptions },
    };
  }
}
