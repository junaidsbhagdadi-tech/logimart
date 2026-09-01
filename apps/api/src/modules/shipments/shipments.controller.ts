import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles, SuperAdminOnly } from '../../common/rbac/roles.decorator';
import { ShipmentsService } from './shipments.service';
import { LabelsService } from '../labels/labels.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@Controller('api/v1/shipments')
@UseGuards(RolesGuard)
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly labels: LabelsService,
  ) {}

  @Post()
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async create(@Body() dto: CreateShipmentDto, @Req() req: any) {
    // A client may only book under an account it owns (its own, or a same-GSTIN sibling).
    if (req.user.role === UserRole.CLIENT_ADMIN) {
      dto.clientId = await this.shipments.clientBookingAccount(req.user.clientId, dto.clientId);
    }
    return this.shipments.create(dto);
  }

  /** Bulk booking — create up to 500 shipments from an uploaded sheet. */
  @Post('bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async bulk(@Body() dto: { rows: CreateShipmentDto[] }, @Req() req: any) {
    let rows = (dto.rows || []).slice(0, 500);
    if (req.user.role === UserRole.CLIENT_ADMIN) {
      const allowed = await this.shipments.bookableAccountIds(req.user.clientId);
      rows = rows.map((r) => ({ ...r, clientId: r.clientId != null && allowed.has(String(r.clientId)) ? Number(r.clientId) : Number(req.user.clientId) }));
    }
    return this.shipments.bulkCreate(rows);
  }

  // ---- Per-AWB add-on charges ----
  @Get(':awb/addons')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listAddons(@Param('awb') awb: string) {
    return this.shipments.listAddons(awb);
  }

  @Post(':awb/addons')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  addAddon(@Param('awb') awb: string, @Body() dto: any, @Req() req: any) {
    return this.shipments.addAddon(awb, dto, req.user?.sub ? Number(req.user.sub) : undefined);
  }

  @Delete('addons/:id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
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
  list(@Req() req: any, @Query('limit') limit?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? BigInt(req.user.clientId) : undefined;
    return this.shipments.list(clientId, limit ? Number(limit) : 50);
  }

  /** AWB Entry List (Xpresion-style flat grid). Declared before ':awb'. */
  @Get('awb-list')
  awbList(@Req() req: any, @Query('limit') limit?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? BigInt(req.user.clientId) : undefined;
    return this.shipments.awbList(clientId, limit ? Number(limit) : 300);
  }

  @Get(':awb')
  findByAwb(@Param('awb') awb: string) {
    return this.shipments.findByAwb(awb);
  }

  /** Wrong-entry transfer — reassign the AWB to the correct customer (super admin). */
  @Post(':awb/transfer')
  @Roles(UserRole.SYS_ADMIN)
  transfer(@Param('awb') awb: string, @Body() dto: { clientId: number }) {
    return this.shipments.transfer(awb, Number(dto.clientId));
  }

  /** Cancel a shipment — a client can cancel their own AWB before it's dispatched. */
  @Post(':awb/cancel')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  cancel(@Param('awb') awb: string, @Body() dto: { reason?: string }, @Req() req: any) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? Number(req.user.clientId) : undefined;
    return this.shipments.cancel(awb, req.user.sub ? BigInt(req.user.sub) : undefined, clientId, dto?.reason);
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

  /** Re-weigh at hub → raises a debit note for any freight delta. */
  @Post(':awb/reweigh')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
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

  /** Hand-off to a vendor: record vendor + forwarding (carrier) AWB reference. */
  @Post(':awb/forwarding')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  setForwarding(@Param('awb') awb: string, @Body() dto: { vendor?: string; forwardingAwb?: string }) {
    return this.shipments.setForwarding(awb, dto);
  }

  /** Edit an AWB after creation (product / consignee / vendor / values …). Blocked once invoiced. */
  @Post(':awb/edit')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  editShipment(@Param('awb') awb: string, @Body() dto: any, @Req() req: any) {
    return this.shipments.editShipment(awb, dto, { isSuper: req.user?.role === UserRole.SYS_ADMIN });
  }

  /** MPS labels for every child box. ?format=zpl | json (default json). */
  @Get(':awb/print-mps-labels')
  async labelsForAwb(@Param('awb') awb: string) {
    return this.labels.buildForAwb(awb);
  }
}
