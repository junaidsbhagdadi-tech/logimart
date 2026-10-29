import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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

  /** Vendor P&L sheet → differences vs our billing, matched on forwarding no (nothing stored). */
  @Post('reconcile')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  reconcile(@Body() dto: { rows: any[] }) {
    return this.vb.reconcileSheet((dto.rows ?? []).slice(0, 5000));
  }
}
