import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { StatsService } from './stats.service';

@Controller('api/v1/stats')
@UseGuards(RolesGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  overview() {
    return this.stats.overview();
  }

  /** Windowed KPIs for the multi-carrier Shipping Hub home. */
  @Get('hub')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  hub(@Req() req: any, @Query('window') window?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN && req.user.clientId != null ? BigInt(req.user.clientId) : undefined;
    return this.stats.hubSummary((window as any) || '7d', clientId);
  }
}
