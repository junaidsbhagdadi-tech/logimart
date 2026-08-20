import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { RateService } from './rate.service';
import { InvoiceService } from './invoice.service';
import { DisputeDto, GenerateInvoiceDto, PayDto } from './dto/billing.dto';

@Controller('api/v1')
@UseGuards(RolesGuard)
export class BillingController {
  constructor(
    private readonly rates: RateService,
    private readonly invoices: InvoiceService,
  ) {}

  /** Live rate preview for an AWB. */
  @Get('shipments/:awb/rate-quote')
  quote(@Param('awb') awb: string) {
    return this.rates.quoteForShipment(awb);
  }

  /** Generate a consolidated monthly invoice. */
  @Post('billing/invoices/generate')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  generate(@Body() dto: GenerateInvoiceDto) {
    return this.invoices.generate(dto.clientId, dto.periodStart, dto.periodEnd);
  }

  @Get('billing/invoices')
  list(@Req() req: any) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? BigInt(req.user.clientId) : undefined;
    return this.invoices.list(clientId);
  }

  @Get('billing/invoices/:id')
  get(@Param('id') id: string) {
    return this.invoices.get(Number(id));
  }

  /** Lock a line under dispute (clean lines stay payable). */
  @Post('billing/invoices/:id/dispute')
  @Roles(UserRole.FINANCE_EXEC, UserRole.CLIENT_ADMIN, UserRole.SYS_ADMIN)
  dispute(@Param('id') id: string, @Body() dto: DisputeDto) {
    return this.invoices.dispute(Number(id), dto.shipmentId, dto.reason);
  }

  @Post('billing/invoices/:id/pay')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  pay(@Param('id') id: string, @Body() dto: PayDto) {
    return this.invoices.pay(Number(id), dto.amount, dto.tds ?? 0, dto.other ?? 0, dto.otherNote);
  }

  /** Generate (sandbox) GST e-invoice IRN for the invoice. */
  @Post('billing/invoices/:id/einvoice')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  einvoice(@Param('id') id: string) {
    return this.invoices.generateEInvoice(Number(id));
  }

  /** Bill-working export (per-AWB charge breakdown) for a client — matches the bill sheet. */
  @Get('billing/bill-worksheet')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  billWorksheet(@Query('clientId') clientId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.invoices.billWorksheet(Number(clientId), from, to);
  }

  /** Receivables aging across all clients (current / 1-30 / 31-60 / 61-90 / 90+). */
  @Get('billing/aging')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  aging() {
    return this.invoices.aging();
  }

  /** Statement of Account for one client (ledger + per-invoice outstanding). */
  @Get('billing/clients/:id/statement')
  @Roles(UserRole.FINANCE_EXEC, UserRole.CLIENT_ADMIN, UserRole.SYS_ADMIN)
  statement(@Param('id') id: string) {
    return this.invoices.statement(Number(id));
  }

  /** Credit limit / outstanding / hold status. */
  @Get('clients/:id/credit')
  @Roles(UserRole.FINANCE_EXEC, UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  credit(@Param('id') id: string) {
    return this.invoices.getCredit(Number(id));
  }
}
