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
}
