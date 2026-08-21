import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PincodesService } from './pincodes.service';

@Controller('api/v1/pincodes')
export class PincodesController {
  constructor(private readonly pincodes: PincodesService) {}

  // Public-ish lookup/search — used during booking by any staff/client.
  @Get('search')
  search(@Query('q') q: string) {
    return this.pincodes.search(q ?? '');
  }

  /** Full serviceable list (master-data screen) — staff only. */
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  list(@Query('limit') limit?: string) {
    return this.pincodes.list(limit ? Number(limit) : 200);
  }

  /** Directory completeness stats (total + per-product zone coverage). Declared before ':pincode'. */
  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  stats() {
    return this.pincodes.stats();
  }

  /** Add / update a serviceable pincode. */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(@Body() dto: { pincode: string; city: string; state: string; region: string; tier: number; isOda?: boolean }) {
    return this.pincodes.create(dto);
  }

  // ---- serviceability coverage (SELF network / vendor-wise) ----
  // NOTE: declared before the ':pincode' catch-all so these static paths match first.
  @Get('service-areas/networks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  networks() {
    return this.pincodes.networks();
  }

  @Get('service-areas')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  serviceAreas(@Query('network') network?: string, @Query('limit') limit?: string) {
    return this.pincodes.listServiceAreas(network || undefined, limit ? Number(limit) : 500);
  }

  /** Bulk upload serviceable pincodes for a network (SELF or a vendor). */
  @Post('service-areas/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  bulkServiceAreas(@Body() dto: { rows: any[]; defaultNetwork?: string }) {
    return this.pincodes.bulkServiceAreas(dto.rows ?? [], dto.defaultNetwork || 'SELF');
  }

  /** Bulk upload the pincode → per-product zone + EDL mapping (PINCODE MAPPING format). */
  @Post('mapping/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  bulkMapping(@Body() dto: { rows: any[] }) {
    return this.pincodes.bulkMapping(dto.rows ?? []);
  }

  /** Which networks/products serve a pincode (fastest TAT first) — used by booking auto-pick. */
  @Get('service-options/:pincode')
  serviceOptions(@Param('pincode') pincode: string) {
    return this.pincodes.serviceOptions(pincode);
  }

  @Get(':pincode')
  lookup(@Param('pincode') pincode: string) {
    return this.pincodes.lookup(pincode);
  }
}
