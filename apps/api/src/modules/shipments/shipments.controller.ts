import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles, SuperAdminOnly, Feature } from '../../common/rbac/roles.decorator';
import { ShipmentsService } from './shipments.service';
import { BulkBookingService } from './bulk-booking.service';
import { LabelsService } from '../labels/labels.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { assertClientInScope, scopedClientIds } from '../../common/scope/data-scope';

@Controller('api/v1/shipments')
@UseGuards(RolesGuard)
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly bulkJobs: BulkBookingService,
    private readonly labels: LabelsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Feature('/create') // a user granted the '/create' (New Shipment) feature can book, additive to @Roles
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN, UserRole.DRIVER)
  async create(@Body() dto: CreateShipmentDto, @Req() req: any) {
    // A client may only book under an account it owns (its own, or a same-GSTIN sibling).
    if (req.user.role === UserRole.CLIENT_ADMIN) {
      dto.clientId = await this.shipments.clientBookingAccount(req.user.clientId, dto.clientId);
    }
    return this.shipments.create(dto, { createdById: req.user?.sub ? BigInt(req.user.sub) : undefined });
  }

  /** Rider app — shipments I booked on a day (IST, default today): reopen, edit, hand off, print, manifest. */
  @Get('my-bookings')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.WAREHOUSE_HANDLER, UserRole.SYS_ADMIN)
  myBookings(@Req() req: any, @Query('date') date?: string) {
    return this.shipments.myBookings(BigInt(req.user.sub), date);
  }

  /** Lightweight customer picker for the pickup-boy (DRIVER) mobile booking — id/name/code only. */
  @Get('booking-customers')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.WAREHOUSE_HANDLER, UserRole.FINANCE_EXEC, UserRole.SALES, UserRole.SYS_ADMIN)
  async bookingCustomers(@Req() req: any, @Query('q') q?: string) {
    return this.shipments.bookingCustomers(q, await scopedClientIds(this.prisma, req.user));
  }

  /** Bulk booking — create up to 500 shipments from an uploaded sheet. */
  @Post('bulk')
  @Feature('/bulk') // a user granted the '/bulk' (Bulk Booking) feature can bulk-book, additive to @Roles
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async bulk(@Body() dto: { rows: CreateShipmentDto[] }, @Req() req: any) {
    let rows = (dto.rows || []).slice(0, 500);
    if (req.user.role === UserRole.CLIENT_ADMIN) {
      const allowed = await this.shipments.bookableAccountIds(req.user.clientId);
      rows = rows.map((r) => ({ ...r, clientId: r.clientId != null && allowed.has(String(r.clientId)) ? Number(r.clientId) : Number(req.user.clientId) }));
    }
    return this.shipments.bulkCreate(rows);
  }

  // ---- Background bulk-booking jobs (large uploads: no request timeout, resumable) ----
  // Declared before the ':awb' routes so 'bulk-jobs' is not captured as an AWB.

  /** Create an empty job; the web then appends rows and starts it. */
  @Post('bulk-jobs')
  @Feature('/bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async createBulkJob(@Req() req: any) {
    const isClient = req.user.role === UserRole.CLIENT_ADMIN;
    return this.bulkJobs.createJob({
      createdById: req.user.sub != null ? BigInt(req.user.sub) : null,
      clientId: isClient && req.user.clientId != null ? BigInt(req.user.clientId) : null,
      isClient,
    });
  }

  /** Append a chunk of rows to a job (the web uploads the file in small chunks). */
  @Post('bulk-jobs/:id/rows')
  @Feature('/bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async appendBulkJobRows(@Param('id') id: string, @Body() dto: { rows: CreateShipmentDto[] }, @Req() req: any) {
    let rows = dto.rows || [];
    if (req.user.role === UserRole.CLIENT_ADMIN) {
      const allowed = await this.shipments.bookableAccountIds(req.user.clientId);
      rows = rows.map((r) => ({ ...r, clientId: r.clientId != null && allowed.has(String(r.clientId)) ? Number(r.clientId) : Number(req.user.clientId) }));
    }
    return this.bulkJobs.appendRows(BigInt(id), rows);
  }

  /** Kick off background processing. */
  @Post('bulk-jobs/:id/start')
  @Feature('/bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async startBulkJob(@Param('id') id: string) {
    return this.bulkJobs.start(BigInt(id));
  }

  @Post('bulk-jobs/:id/cancel')
  @Feature('/bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async cancelBulkJob(@Param('id') id: string) {
    return this.bulkJobs.cancel(BigInt(id));
  }

  /** Undo a whole bulk-booking batch — voids every AWB it created (wrong-file recovery). */
  @Post('bulk-jobs/:id/undo')
  @Feature('/bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async undoBulkJob(@Param('id') id: string, @Req() req: any) {
    const isClient = req.user.role === UserRole.CLIENT_ADMIN;
    return this.bulkJobs.undoJob(BigInt(id), {
      userId: req.user.sub != null ? BigInt(req.user.sub) : undefined,
      clientId: isClient ? Number(req.user.clientId) : undefined,
      isSuper: req.user.role === UserRole.SYS_ADMIN,
    });
  }

  /** Recent jobs for the current user (admins see all). */
  @Get('bulk-jobs')
  @Feature('/bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async listBulkJobs(@Req() req: any) {
    const isSuper = req.user.role === UserRole.SYS_ADMIN || req.user.role === UserRole.ADMIN;
    return this.bulkJobs.recent(req.user.sub != null ? BigInt(req.user.sub) : null, isSuper);
  }

  /** Live progress of one job (polled by the web). */
  @Get('bulk-jobs/:id')
  @Feature('/bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async getBulkJob(@Param('id') id: string) {
    return this.bulkJobs.progress(BigInt(id));
  }

  // ---- Per-AWB add-on charges ----
  @Get(':awb/addons')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.WAREHOUSE_HANDLER, UserRole.SYS_ADMIN)
  listAddons(@Param('awb') awb: string) {
    return this.shipments.listAddons(awb);
  }

  @Post(':awb/addons')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.WAREHOUSE_HANDLER, UserRole.SYS_ADMIN)
  addAddon(@Param('awb') awb: string, @Body() dto: any, @Req() req: any) {
    return this.shipments.addAddon(awb, dto, req.user?.sub ? Number(req.user.sub) : undefined);
  }

  @Delete('addons/:id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.WAREHOUSE_HANDLER, UserRole.SYS_ADMIN)
  removeAddon(@Param('id') id: string) {
    return this.shipments.removeAddon(Number(id));
  }

  // ---- Customer portal self-service (own shipments only) ----
  @Post(':awb/portal-appointment')
  @Roles(UserRole.CLIENT_ADMIN)
  portalAppointment(@Param('awb') awb: string, @Body() dto: { date?: string; remark?: string }, @Req() req: any) {
    return this.shipments.portalAppointment(awb, Number(req.user.clientId), dto);
  }

  @Post(':awb/portal-remark')
  @Roles(UserRole.CLIENT_ADMIN)
  portalRemark(@Param('awb') awb: string, @Body() dto: { remark: string }, @Req() req: any) {
    return this.shipments.portalRemark(awb, Number(req.user.clientId), dto);
  }

  /** Portal rate-check estimate (gated by the customer's canCheckRates flag). */
  @Post('portal-rate-estimate')
  @Roles(UserRole.CLIENT_ADMIN)
  portalEstimate(@Body() dto: any, @Req() req: any) {
    return this.shipments.estimate(Number(req.user.clientId), dto);
  }

  /** Portal rate-check across the customer's assigned vendors (one rate per vendor). */
  @Post('portal-rate-estimate-vendors')
  @Roles(UserRole.CLIENT_ADMIN)
  portalEstimateVendors(@Body() dto: any, @Req() req: any) {
    return this.shipments.estimateVendors(Number(req.user.clientId), dto);
  }

  /** Staff carrier-rate comparison at booking — every carrier priced, cheapest first. */
  @Post('carrier-rates')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  carrierRates(@Body() dto: { clientId: number } & any) {
    return this.shipments.carrierRates(Number(dto.clientId), dto);
  }

  /** #25 — effective volumetric divisor + CFT for a customer × product × vendor, so the booking
   *  screen's per-box vol preview matches what the engine actually bills. */
  @Get('vol-config')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  volConfig(@Query('clientId') clientId: string, @Query('product') product: string, @Query('vendor') vendor?: string) {
    return this.shipments.volConfig(Number(clientId), product, vendor);
  }

  /** Super-admin: delete selected AWBs (and their children). Used by the AWB list select/delete. */
  @Post('bulk-delete')
  @Roles(UserRole.SYS_ADMIN)
  @SuperAdminOnly()
  bulkDelete(@Body() dto: { awbs: string[] }) {
    return this.shipments.bulkDelete(dto?.awbs || []);
  }

  /** List recent shipments. Client admins see only their own; staff see all. */
  @Get()
  async list(@Req() req: any, @Query('limit') limit?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN && req.user.clientId != null ? BigInt(req.user.clientId) : undefined;
    return this.shipments.list(clientId, limit ? Number(limit) : 50, clientId == null ? await scopedClientIds(this.prisma, req.user) : null);
  }

  /** AWB Entry List (Xpresion-style flat grid). Declared before ':awb'. `search` matches any AWB
   *  across all shipments (not just the latest page). */
  /** Portal: CS comments awaiting the customer (drives the customer's popup). Declared before ':awb'. */
  @Get('portal/cs-comments')
  @Roles(UserRole.CLIENT_ADMIN)
  portalCsComments(@Req() req: any) {
    if (req.user.clientId == null) return [];
    return this.shipments.portalCsComments(Number(req.user.clientId));
  }

  /** Portal: mark a CS comment read, optionally replying (the reply lights the CS bell). */
  @Post(':awb/portal-cs-read')
  @Roles(UserRole.CLIENT_ADMIN)
  portalCsRead(@Param('awb') awb: string, @Body() dto: { reply?: string }, @Req() req: any) {
    return this.shipments.portalCsCommentRead(awb, Number(req.user.clientId), dto || {});
  }

  @Get('awb-list')
  async awbList(@Req() req: any, @Query('limit') limit?: string, @Query('search') search?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('ewbPending') ewbPending?: string, @Query('vendors') vendors?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN && req.user.clientId != null ? BigInt(req.user.clientId) : undefined;
    const scope = clientId == null ? await scopedClientIds(this.prisma, req.user) : null;
    return this.shipments.awbList(clientId, limit ? Number(limit) : 300, search, from, to, scope, ewbPending === '1' || ewbPending === 'true', vendors ? vendors.split(',') : undefined);
  }

  @Get(':awb')
  async findByAwb(@Param('awb') awb: string, @Req() req: any) {
    const s = await this.shipments.findByAwb(awb);
    // A customer login may only open its own account group's AWBs; scoped staff only their branch/company's.
    if (req.user.role === UserRole.CLIENT_ADMIN) {
      const allowed = await this.shipments.bookableAccountIds(req.user.clientId);
      if (!allowed.has(String(s.clientId))) throw new NotFoundException(`AWB ${awb} not found`);
    } else {
      await assertClientInScope(this.prisma, req.user, s.clientId);
    }
    // Never ship the customer's API key with a shipment (riders / CS / customers all read this).
    if ((s as any).client) delete (s as any).client.apiKey;
    return s;
  }

  /** Wrong-entry transfer — reassign the AWB to the correct customer (finance/super admin — changes who's billed). */
  @Post(':awb/transfer')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  transfer(@Param('awb') awb: string, @Body() dto: { clientId: number }) {
    return this.shipments.transfer(awb, Number(dto.clientId));
  }

  /** Cancel/void a shipment — a client can cancel their own AWB before dispatch; a super admin can
   *  void a wrong AWB at any stage (excluded from billing, and cancelled with the carrier if handed off). */
  @Post(':awb/cancel')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN, UserRole.DRIVER)
  async cancel(@Param('awb') awb: string, @Body() dto: { reason?: string }, @Req() req: any) {
    // A rider (app) may cancel only their own booking, before pickup / carrier hand-off.
    if (req.user?.role === UserRole.DRIVER) await this.shipments.assertRiderCanEdit(awb, BigInt(req.user.sub));
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? Number(req.user.clientId) : undefined;
    return this.shipments.cancel(awb, req.user.sub ? BigInt(req.user.sub) : undefined, clientId, dto?.reason, { isSuper: req.user?.role === UserRole.SYS_ADMIN });
  }

  /** #14 — bulk change from the vendor-bill sheet (blank cell = unchanged). Max 500 rows per call. */
  @Post('bulk-change')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  bulkChange(@Body() dto: { rows: any[] }, @Req() req: any) {
    return this.shipments.bulkChange((dto?.rows || []).slice(0, 500), { isSuper: req.user?.role === UserRole.SYS_ADMIN });
  }

  /** Bulk void — void several AWBs at once (each guarded like the single void). */
  @Post('bulk-cancel')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  bulkCancel(@Body() dto: { awbs: string[]; reason?: string }, @Req() req: any) {
    return this.shipments.bulkCancel(dto?.awbs || [], req.user.sub ? BigInt(req.user.sub) : undefined, undefined, dto?.reason, { isSuper: req.user?.role === UserRole.SYS_ADMIN });
  }

  /** Bulk booking-date change — correct the booking date (createdAt) on several AWBs (not invoiced).
   *  Finance uses this to move shipments into the month they're billed in. */
  @Post('bulk-date')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  bulkDate(@Body() dto: { awbs: string[]; date: string }) {
    return this.shipments.bulkChangeDate(dto?.awbs || [], dto?.date);
  }

  /** Assign a rider for last-mile delivery. */
  @Post(':awb/assign-delivery')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  assignDelivery(@Param('awb') awb: string, @Body() dto: { riderId: number }) {
    return this.shipments.assignDelivery(awb, dto.riderId);
  }

  /** Rider marks Out For Delivery. */
  @Post(':awb/ofd')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  ofd(@Param('awb') awb: string, @Req() req: any) {
    return this.shipments.markOfd(awb, BigInt(req.user.sub));
  }

  /** Re-weigh → raises a debit note for any freight delta. Finance only (changes billed weight). */
  @Post(':awb/reweigh')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  reweigh(
    @Param('awb') awb: string,
    @Body() dto: { lines: { sequenceNo: number; actualKg: number; lengthCm?: number; widthCm?: number; heightCm?: number }[] },
    @Req() req: any,
  ) {
    return this.shipments.reweigh(awb, dto.lines, req.user?.sub ? Number(req.user.sub) : undefined);
  }

  /** DOD — record the cheque/DD collected from the consignee (unlocks delivery). */
  @Post(':awb/dod/collect')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  collectDod(
    @Param('awb') awb: string,
    @Body() dto: { reference: string; bankName?: string; amount?: number },
    @Req() req: any,
  ) {
    return this.shipments.collectDod(awb, dto, BigInt(req.user.sub));
  }

  /** DOD — record handover of the collected draft to the consignor. */
  @Post(':awb/dod/handover')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  handoverDod(@Param('awb') awb: string) {
    return this.shipments.handoverDod(awb);
  }

  /** DOD — cheque photo + courier AWB/date the cheque was forwarded under (from the tracking page). */
  @Post(':awb/dod/cheque')
  @Roles(UserRole.DRIVER, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  dodCheque(@Param('awb') awb: string, @Body() dto: { dataUrl?: string; courierAwb?: string; forwardedAt?: string; reference?: string }) {
    return this.shipments.dodCheque(awb, dto || {});
  }

  /** To-Pay — record freight collected from the consignee at delivery. */
  @Post(':awb/collect-freight')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  collectFreight(@Param('awb') awb: string, @Body() dto: { amount: number }, @Req() req: any) {
    return this.shipments.collectFreight(awb, dto.amount, BigInt(req.user.sub));
  }

  /** Manually override this shipment's charges (finance/ops). Body: { overrides: { CODE: amount } } or null to clear. */
  @Post(':awb/charge-overrides')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  setChargeOverrides(@Param('awb') awb: string, @Body() dto: { overrides: Record<string, number> | null }) {
    return this.shipments.setChargeOverrides(awb, dto?.overrides ?? null);
  }

  /** Booking-time payment at the counter: cash or wallet debit. Returns receipt data. */
  @Post(':awb/pay')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  payAtBooking(@Param('awb') awb: string, @Body() dto: { amount: number; method?: string }, @Req() req: any) {
    return this.shipments.payAtBooking(awb, dto, BigInt(req.user.sub));
  }

  /** Re-view / reprint a counter (cash/wallet) receipt for an already-paid shipment. */
  @Get(':awb/cash-receipt')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  cashReceipt(@Param('awb') awb: string) {
    return this.shipments.cashReceipt(awb);
  }

  /** Hand-off to a vendor: record vendor + forwarding (carrier) AWB reference. WAREHOUSE_HANDLER
   *  (incl. Customer Service staff) can do it too — an exceptional hand-off from the tracking screen. */
  @Post(':awb/forwarding')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.DRIVER)
  async setForwarding(@Param('awb') awb: string, @Body() dto: { vendor?: string; forwardingAwb?: string }, @Req() req: any) {
    if (req.user?.role === UserRole.DRIVER) await this.shipments.assertRiderCanEdit(awb, BigInt(req.user.sub));
    return this.shipments.setForwarding(awb, dto, { isSuper: req.user?.role === UserRole.SYS_ADMIN });
  }

  /** RTO: record the return carrier no (+ optional own return AWB, default original + "R") → books + bills the
   *  return leg; the original closes as Returned when the return is delivered. */
  @Post(':awb/rto-close')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  rtoClose(@Param('awb') awb: string, @Body() dto: { returnAwb?: string; forwardingNo?: string; vendor?: string }, @Req() req: any) {
    return this.shipments.rtoClose(awb, dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }

  /** Attach an invoice copy / document to an AWB (app: photo or PDF as a data URL). A rider: own bookings only. */
  @Post(':awb/attachments')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.DRIVER)
  async attach(@Param('awb') awb: string, @Body() dto: { dataUrl?: string; docType?: string; label?: string }, @Req() req: any) {
    if (req.user?.role === UserRole.DRIVER) await this.shipments.assertRiderOwns(awb, BigInt(req.user.sub));
    return this.shipments.attachDocument(awb, dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }

  /** Edit an AWB after creation (product / consignee / vendor / values …). Blocked once invoiced. */
  @Post(':awb/edit')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.DRIVER)
  async editShipment(@Param('awb') awb: string, @Body() dto: any, @Req() req: any) {
    // A rider (app) may correct only their OWN booking, before it's picked or handed to a carrier.
    if (req.user?.role === UserRole.DRIVER) await this.shipments.assertRiderCanEdit(awb, BigInt(req.user.sub));
    return this.shipments.editShipment(awb, dto, { isSuper: req.user?.role === UserRole.SYS_ADMIN });
  }

  /** MPS labels for every child box. ?format=zpl | json (default json). */
  @Get(':awb/print-mps-labels')
  async labelsForAwb(@Param('awb') awb: string) {
    return this.labels.buildForAwb(awb);
  }
}
