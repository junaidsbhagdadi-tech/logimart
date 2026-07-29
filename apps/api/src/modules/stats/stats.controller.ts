import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
