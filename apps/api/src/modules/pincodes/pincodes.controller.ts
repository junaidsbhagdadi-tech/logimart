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

  /** Add / update a serviceable pincode. */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(@Body() dto: { pincode: string; city: string; state: string; region: string; tier: number; isOda?: boolean }) {
    return this.pincodes.create(dto);
  }

  @Get(':pincode')
  lookup(@Param('pincode') pincode: string) {
    return this.pincodes.lookup(pincode);
  }
}
