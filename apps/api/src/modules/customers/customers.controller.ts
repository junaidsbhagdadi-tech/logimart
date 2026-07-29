import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
