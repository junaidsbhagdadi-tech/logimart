import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { VendorsService } from './vendors.service';

@Controller('api/v1/vendors')
@UseGuards(RolesGuard)
@Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Post()
  create(@Body() dto: any) {
    return this.vendors.create(dto);
  }

  @Get()
  list() {
    return this.vendors.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.vendors.get(Number(id));
  }

  @Post(':id/payments')
  addPayment(@Param('id') id: string, @Body() dto: any) {
    return this.vendors.addPayment(Number(id), dto);
  }

  @Patch('payments/:paymentId/paid')
  markPaid(@Param('paymentId') paymentId: string) {
    return this.vendors.markPaid(Number(paymentId));
  }
}
