import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PerBoxService } from './per-box.service';

/** Manage pcs-slab (per-box) rate cards — the alternative freight basis. */
@Controller('api/v1/per-box-rates')
@UseGuards(RolesGuard)
@Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
export class PerBoxController {
  constructor(private readonly svc: PerBoxService) {}

  @Get()
  list(@Query('clientId') clientId: string) {
    return this.svc.listCards(Number(clientId));
  }

  @Post()
  create(@Body() dto: any) {
    return this.svc.createCard(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.removeCard(Number(id));
  }
}
