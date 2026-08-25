import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { RateService } from './rate.service';
import { InvoiceService } from './invoice.service';
import { DisputeDto, GenerateBatchDto, GenerateInvoiceDto, PayDto } from './dto/billing.dto';

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

  /** Batch run: single / multiple / all customers for a period. */
  @Post('billing/invoices/generate-batch')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  async generateBatch(@Body() dto: GenerateBatchDto) {
    const ids = dto.scope === 'ALL'
      ? await this.invoices.eligibleClientIdsForPeriod(dto.periodStart, dto.periodEnd)
      : (dto.clientIds ?? []);
    return this.invoices.generateMany(ids, dto.periodStart, dto.periodEnd);
  }

  @Get('billing/invoices')
  list(@Req() req: any) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? BigInt(req.user.clientId) : undefined;
    return this.invoices.list(clientId);
  }

  @Get('billing/invoices/:id')
  async get(@Param('id') id: string, @Req() req: any) {
    const inv = await this.invoices.get(Number(id));
    // A client may only open its OWN invoices.
    if (req.user.role === UserRole.CLIENT_ADMIN && String((inv as any).clientId) !== String(req.user.clientId)) {
      throw new NotFoundException('Invoice not found');
    }
    return inv;
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

  /** Lock (issue) a DRAFT invoice — posts the ledger charge and freezes it (#5). */
  @Post('billing/invoices/:id/lock')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  lock(@Param('id') id: string) {
    return this.invoices.lockInvoice(Number(id));
  }

  /** Add an AWB to a DRAFT invoice (#8). */
  @Post('billing/invoices/:id/add-awb')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  addAwb(@Param('id') id: string, @Body() dto: { awb: string }) {
    return this.invoices.addAwbToInvoice(Number(id), dto?.awb);
  }

  /** Remove an AWB line from a DRAFT invoice (#8). */
  @Post('billing/invoices/:id/remove-awb')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  removeAwb(@Param('id') id: string, @Body() dto: { shipmentId: number }) {
    return this.invoices.removeAwbFromInvoice(Number(id), Number(dto?.shipmentId));
  }

  /** Delete an invoice (#4) — DRAFT freely; a locked one reverses its ledger charge. Blocked if paid. */
  @Post('billing/invoices/:id/delete')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  remove(@Param('id') id: string) {
    return this.invoices.deleteInvoice(Number(id));
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

  /** Head-wise charge breakup of billed AWBs (freight/fuel/fov/oda/…) for Excel export. */
  @Get('billing/charge-breakup')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  chargeBreakup(@Query('clientId') clientId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.invoices.chargeBreakup(clientId ? Number(clientId) : undefined, from, to);
  }

  /** AWB-wise profit/loss: vendor cost (uploaded bills) vs our sell (rate engine). */
  @Get('billing/pnl')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  pnl(@Query('from') from?: string, @Query('to') to?: string) {
    return this.invoices.pnl(from, to);
  }

  /** Receivables aging across all clients (current / 1-30 / 31-60 / 61-90 / 90+). */
  @Get('billing/aging')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  aging() {
    return this.invoices.aging();
  }

  /** Statement of Account for one client (ledger + per-invoice outstanding). */
  @Get('clients/:id/overview')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  customerOverview(@Param('id') id: string) {
    return this.invoices.customerOverview(Number(id));
  }

  /** Customer self-service portal summary — scoped to the logged-in client. */
  @Get('portal/overview')
  @Roles(UserRole.CLIENT_ADMIN)
  portal(@Req() req: any) {
    return this.invoices.clientPortal(Number(req.user.clientId));
  }

  /** Accounts the logged-in client can book under (own + same-GSTIN siblings) with shipper defaults. */
  @Get('portal/accounts')
  @Roles(UserRole.CLIENT_ADMIN)
  portalAccounts(@Req() req: any) {
    return this.invoices.bookableAccounts(Number(req.user.clientId));
  }

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
