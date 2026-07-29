import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ScansService } from './scans.service';
import { BulkSyncDto } from './dto/bulk-sync.dto';

@Controller('api/v1/scans')
@UseGuards(RolesGuard)
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  /**
   * Offline-first bulk sync. Returns 207-style per-event outcome so the device
   * clears accepted + duplicate from its local queue and retries only rejected.
   */
  @Post('bulk-sync')
  @HttpCode(207)
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  bulkSync(@Body() dto: BulkSyncDto, @Req() req: any) {
    const scannedById = BigInt(req.user.sub);
    return this.scans.bulkSync(dto, scannedById);
  }
}
