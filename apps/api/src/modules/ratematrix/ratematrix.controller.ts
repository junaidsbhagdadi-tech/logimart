import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { RateMatrixService } from './ratematrix.service';

@Controller('api/v1/rate-slabs')
@UseGuards(RolesGuard)
export class RateMatrixController {
  constructor(private readonly rm: RateMatrixService) {}

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  list(@Query('clientId') clientId?: string) {
    return this.rm.list(clientId ? Number(clientId) : undefined);
  }

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  create(@Body() d: any) {
    return this.rm.create(d);
  }

  @Post('bulk')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  bulk(@Body() d: { rows: any[] }) {
    return this.rm.bulk(d.rows ?? []);
  }

  @Delete(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  remove(@Param('id') id: string) {
    return this.rm.remove(Number(id));
  }
}
