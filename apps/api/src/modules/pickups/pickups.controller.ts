import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles, Feature } from '../../common/rbac/roles.decorator';
import { PickupsService } from './pickups.service';
import { PrismaService } from '../../prisma/prisma.service';
import { assertClientInScope, scopedClientIds } from '../../common/scope/data-scope';

class CreatePickupDto {
  @IsOptional() @IsInt() clientId?: number; // ignored for client admins (taken from token)
  @IsString() @MinLength(4) pickupAddress!: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsInt() estPieces?: number;
  @IsOptional() @IsString() cargoMode?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsBoolean() isWarehouse?: boolean;
  @IsOptional() @IsString() refNo?: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() invoiceDate?: string;
  @IsOptional() @IsNumber() invoiceValue?: number;
  @IsOptional() @IsString() ewbNo?: string;
  @IsOptional() @IsString() notes?: string;
}
class AssignDto {
  @IsInt() riderId!: number;
}
class CompleteDto {
  @IsOptional() @IsString() awb?: string;
  // the vendor's AWB — our internal AWB is generated and this is stored as the forwarding no
  @IsOptional() @IsString() forwardingNo?: string;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsInt() pieces?: number;
  @IsOptional() @IsNumber() value?: number;
  // Destination + consignee → books the billable shipment for the customer at mark-picked.
  @IsOptional() @IsString() destPincode?: string;
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsString() consigneePhone?: string;
  @IsOptional() @IsString() consigneeAddress?: string;
}
class HandoffDto {
  @IsOptional() @IsString() vendor?: string;
  // BlueDart books only with the destination → these book the shipment + generate the AWB at hand-off.
  @IsOptional() @IsString() destPincode?: string;
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsString() consigneePhone?: string;
  @IsOptional() @IsString() consigneeAddress?: string;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsInt() pieces?: number;
  @IsOptional() @IsNumber() value?: number;
  @IsOptional() @IsBoolean() toPay?: boolean;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() token?: string;
}

@Controller('api/v1/pickups')
@UseGuards(RolesGuard)
@Feature('/pickups') // CS / ops granted Pickups (EDIT) can book, hand off, assign and mark picked
export class PickupsController {
  constructor(private readonly pickups: PickupsService, private readonly prisma: PrismaService) {}

  @Post()
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async create(@Body() dto: CreatePickupDto, @Req() req: any) {
    const clientId =
      req.user.role === UserRole.CLIENT_ADMIN ? Number(req.user.clientId) : dto.clientId!;
    return this.pickups.create({ ...dto, clientId, ...(await this.by(req)) });
  }

  /** Bulk pickup upload. A client-portal login is pinned to its own account; ops staff resolve
   *  each row's customer from the sheet (accountCode / id). */
  @Post('bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async bulk(@Body() body: { rows: any[]; vendor?: string }, @Req() req: any) {
    const forced = req.user.role === UserRole.CLIENT_ADMIN ? Number(req.user.clientId) : undefined;
    const by = await this.by(req);
    return this.pickups.bulkCreate(body?.rows ?? [], forced, body?.vendor, { id: by.createdById, name: by.createdByName });
  }

  /** Who is booking — stored on the request ("Booked by" on the pickups list). */
  private async by(req: any): Promise<{ createdById?: number; createdByName?: string }> {
    const id = req.user?.sub ? Number(req.user.sub) : undefined;
    if (!id) return {};
    const u = await this.prisma.user.findUnique({ where: { id: BigInt(id) }, select: { fullName: true, riderCode: true } }).catch(() => null);
    return { createdById: id, createdByName: u ? `${u.fullName}${u.riderCode ? ` (${u.riderCode})` : ''}` : undefined };
  }

  @Get()
  async list(@Req() req: any) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN && req.user.clientId != null ? BigInt(req.user.clientId) : undefined;
    return this.pickups.list(clientId, clientId == null ? await scopedClientIds(this.prisma, req.user) : null);
  }

  /** Unified pickups across all carriers (internal requests + BlueDart) — for the mobile Pickups app. */
  @Get('unified')
  async unified(@Req() req: any, @Query('status') status?: string, @Query('carrier') carrier?: string, @Query('window') window?: string) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? Number(req.user.clientId) : undefined;
    const scope = clientId == null ? await scopedClientIds(this.prisma, req.user) : null;
    return this.pickups.unified({ status, carrier, window: (window as any) || 'all', clientId, scope });
  }

  /** Full detail for the CS pickup-request popup. */
  @Get(':id')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  async detail(@Param('id') id: string, @Req() req: any) {
    const p = await this.pickups.detail(Number(id));
    await assertClientInScope(this.prisma, req.user, p.clientId);
    return p;
  }

  /** CS hands the pickup off to a vendor → BlueDart generates a pickup token; other vendors record it
   *  (with an optional manual token). CS may override the customer's vendor choice. */
  @Post(':id/handoff')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  handoff(@Param('id') id: string, @Body() body: HandoffDto) {
    return this.pickups.handoff(Number(id), body || {});
  }

  @Post(':id/assign')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  assign(@Param('id') id: string, @Body() dto: AssignDto) {
    return this.pickups.assign(Number(id), dto.riderId);
  }

  @Post(':id/complete')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  complete(@Param('id') id: string, @Body() body: CompleteDto, @Req() req: any) {
    return this.pickups.complete(Number(id), body || {}, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }
}
