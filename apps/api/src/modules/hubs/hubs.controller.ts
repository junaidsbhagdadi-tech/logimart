import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { HubsService } from './hubs.service';

@Controller('api/v1/hubs')
@UseGuards(RolesGuard)
export class HubsController {
  constructor(private readonly hubs: HubsService) {}

  /** Any authenticated user can read hubs (to populate booking dropdowns). */
  @Get()
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.HUB_MANAGER,
    UserRole.WAREHOUSE_HANDLER,
    UserRole.DRIVER,
    UserRole.FINANCE_EXEC,
    UserRole.SYS_ADMIN,
  )
  list() {
    return this.hubs.list();
  }

  /** Add / update a hub. */
  @Post()
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(@Body() dto: { code: string; name: string; zone: string }) {
    return this.hubs.create(dto);
  }
}
