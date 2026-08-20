import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { CarrierRatesService } from './carrierrates.service';

@Controller('api/v1/carrier-rate-cards')
@UseGuards(RolesGuard)
export class CarrierRatesController {
  constructor(private readonly rates: CarrierRatesService) {}

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  list(@Query('clientId') clientId?: string) {
    return this.rates.list(clientId ? Number(clientId) : undefined);
  }

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  create(@Body() body: any) {
    return this.rates.create(body);
  }

  @Delete(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  remove(@Param('id') id: string) {
    return this.rates.remove(Number(id));
  }
}
