import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PickupsService } from './pickups.service';

class CreatePickupDto {
  @IsOptional() @IsInt() clientId?: number; // ignored for client admins (taken from token)
  @IsString() @MinLength(4) pickupAddress!: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsInt() estPieces?: number;
  @IsOptional() @IsString() cargoMode?: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() invoiceDate?: string;
  @IsOptional() @IsNumber() invoiceValue?: number;
  @IsOptional() @IsString() ewbNo?: string;
  @IsOptional() @IsString() notes?: string;
}
class AssignDto {
  @IsInt() riderId!: number;
}

@Controller('api/v1/pickups')
@UseGuards(RolesGuard)
export class PickupsController {
  constructor(private readonly pickups: PickupsService) {}

  @Post()
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(@Body() dto: CreatePickupDto, @Req() req: any) {
    const clientId =
      req.user.role === UserRole.CLIENT_ADMIN ? Number(req.user.clientId) : dto.clientId!;
    return this.pickups.create({ ...dto, clientId });
  }

  /** Bulk pickup upload. A client-portal login is pinned to its own account; ops staff resolve
   *  each row's customer from the sheet (accountCode / id). */
  @Post('bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  bulk(@Body() body: { rows: any[] }, @Req() req: any) {
    const forced = req.user.role === UserRole.CLIENT_ADMIN ? Number(req.user.clientId) : undefined;
    return this.pickups.bulkCreate(body?.rows ?? [], forced);
  }

  @Get()
  list(@Req() req: any) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? BigInt(req.user.clientId) : undefined;
    return this.pickups.list(clientId);
  }

  @Post(':id/assign')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  assign(@Param('id') id: string, @Body() dto: AssignDto) {
    return this.pickups.assign(Number(id), dto.riderId);
  }

  @Post(':id/complete')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  complete(@Param('id') id: string) {
    return this.pickups.complete(Number(id));
  }
}
