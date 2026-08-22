import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

  // ---- Service Mapping (declared before ':id' so the static path matches first) ----
  @Get('service-mappings')
  listMappings() {
    return this.vendors.listMappings();
  }

  /** Auto-pick a carrier for a shipment by chargeable weight (+ optional service / single-piece). */
  @Get('service-mappings/resolve')
  resolveCarrier(@Query('weight') weight?: string, @Query('service') service?: string, @Query('singlePiece') singlePiece?: string) {
    return this.vendors.resolveCarrier({
      weight: Number(weight ?? 0),
      service: service || undefined,
      singlePiece: singlePiece === 'true' ? true : singlePiece === 'false' ? false : undefined,
    });
  }

  @Post('service-mappings')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  addMapping(@Body() dto: any) {
    return this.vendors.addMapping(dto);
  }

  @Delete('service-mappings/:id')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  delMapping(@Param('id') id: string) {
    return this.vendors.delMapping(Number(id));
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
