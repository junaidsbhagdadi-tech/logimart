import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { FuelService } from './fuel.service';

@Controller('api/v1/fuel-price')
@UseGuards(RolesGuard)
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  current(@Query('fuelType') fuelType?: string) {
    return this.fuel.current(fuelType || 'DIESEL');
  }

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  set(@Body() dto: { price: number; fuelType?: string; effectiveFrom?: string; note?: string }) {
    return this.fuel.setPrice(dto);
  }
}
