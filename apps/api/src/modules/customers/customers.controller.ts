import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { CustomersService } from './customers.service';
import { CreateClientDto, UpdateClientDto } from './dto/customer.dto';

@Controller('api/v1/clients')
@UseGuards(RolesGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  create(@Body() dto: CreateClientDto) {
    return this.customers.create(dto);
  }

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  list() {
    return this.customers.list();
  }

  // ---- sub-tabs (declared before ':id' catch-all is fine — these have extra segments) ----
  @Get(':id/fuel-surcharges')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listFuel(@Param('id') id: string) { return this.customers.listFuel(Number(id)); }
  @Post(':id/fuel-surcharges')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  addFuel(@Param('id') id: string, @Body() d: any) { return this.customers.addFuel(Number(id), d); }
  @Delete(':id/fuel-surcharges/:rowId')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  delFuel(@Param('rowId') rowId: string) { return this.customers.delFuel(Number(rowId)); }

  @Get(':id/other-charges')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listCharges(@Param('id') id: string) { return this.customers.listCharges(Number(id)); }
  @Post(':id/other-charges')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  addCharge(@Param('id') id: string, @Body() d: any) { return this.customers.addCharge(Number(id), d); }
  @Delete(':id/other-charges/:rowId')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  delCharge(@Param('rowId') rowId: string) { return this.customers.delCharge(Number(rowId)); }

  @Get(':id/volumetrics')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listVol(@Param('id') id: string) { return this.customers.listVol(Number(id)); }
  @Post(':id/volumetrics')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  addVol(@Param('id') id: string, @Body() d: any) { return this.customers.addVol(Number(id), d); }
  @Delete(':id/volumetrics/:rowId')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  delVol(@Param('rowId') rowId: string) { return this.customers.delVol(Number(rowId)); }

  @Get(':id/addresses')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listAddr(@Param('id') id: string) { return this.customers.listAddr(Number(id)); }
  @Post(':id/addresses')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  addAddr(@Param('id') id: string, @Body() d: any) { return this.customers.addAddr(Number(id), d); }
  @Delete(':id/addresses/:rowId')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  delAddr(@Param('rowId') rowId: string) { return this.customers.delAddr(Number(rowId)); }

  @Get(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  get(@Param('id') id: string) {
    return this.customers.get(Number(id));
  }

  @Patch(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.customers.update(Number(id), dto);
  }
}
