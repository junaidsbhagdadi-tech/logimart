import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles, Feature } from '../../common/rbac/roles.decorator';
import { VendorBillsService } from './vendorbills.service';

@Controller('api/v1/vendor-bills')
@UseGuards(RolesGuard)
@Feature('/vendor-bills')
export class VendorBillsController {
  constructor(private readonly vb: VendorBillsService) {}

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  list(@Query('vendorCode') vendorCode?: string, @Query('awb') awb?: string) {
    return this.vb.list(vendorCode || undefined, awb || undefined);
  }

  @Post('bulk')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  bulk(@Body() dto: { rows: any[] }) {
    return this.vb.bulkUpsert(dto.rows ?? []);
  }

  /** Uploaded bill rows grouped vendor × upload date (IST). */
  @Get('uploads')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  uploads() { return this.vb.uploads(); }

  /** Delete a vendor's uploaded rows — all, or one upload date. */
  @Post('uploads/delete')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  deleteUploads(@Body() dto: { vendorCode: string; day?: string }) { return this.vb.deleteUploads(dto?.vendorCode, dto?.day || undefined); }

  // ---- vendor bill register + payments ----
  @Get('register')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  register(@Query('vendorCode') vendorCode?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string) {
    return this.vb.listInvoices({ vendorCode: vendorCode || undefined, from: from || undefined, to: to || undefined, status: status || undefined });
  }

  @Post('register')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  addInvoice(@Body() dto: any, @Req() req: any) { return this.vb.createInvoice(dto, req.user?.sub ? BigInt(req.user.sub) : undefined); }

  @Delete('register/:id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  delInvoice(@Param('id') id: string) { return this.vb.deleteInvoice(Number(id)); }

  @Get('payments')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  payments(@Query('vendorCode') vendorCode?: string) { return this.vb.listPayments(vendorCode || undefined); }

  @Post('payments')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  pay(@Body() dto: any, @Req() req: any) { return this.vb.recordPayment(dto, req.user?.sub ? BigInt(req.user.sub) : undefined); }

  @Delete('payments/:id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  delPayment(@Param('id') id: string) { return this.vb.deletePayment(Number(id)); }

  /** Vendor P&L sheet → differences vs our billing, matched on forwarding no (nothing stored). */
  @Post('reconcile')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  reconcile(@Body() dto: { rows: any[] }) {
    return this.vb.reconcileSheet((dto.rows ?? []).slice(0, 5000));
  }
}
