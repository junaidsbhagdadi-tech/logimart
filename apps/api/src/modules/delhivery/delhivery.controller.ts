import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { DelhiveryService } from './delhivery.service';

@Controller('api/v1/delhivery')
@UseGuards(RolesGuard)
export class DelhiveryController {
  constructor(private readonly del: DelhiveryService) {}

  @Get('status')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  status() {
    return this.del.status();
  }

  @Get('serviceable/:pincode')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  serviceable(@Param('pincode') pincode: string, @Query('weight') weight?: string) {
    return this.del.serviceability(pincode, weight ? Number(weight) : undefined);
  }

  @Get('tat')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  tat(@Query('origin') origin: string, @Query('dest') dest: string, @Query('mot') mot?: string) {
    return this.del.tat(origin, dest, mot === 'A' ? 'A' : 'S');
  }

  @Post('freight')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  freight(@Body() dto: any) {
    return this.del.freightEstimate(dto);
  }

  /** Hand a Logimart shipment off to Delhivery — creates the LR via the async manifest job. */
  @Post('handoff/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  handoff(@Param('awb') awb: string, @Body() dto?: { pickupName?: string }) {
    return this.del.createManifest(awb, dto?.pickupName);
  }

  @Get('manifest-status/:jobId')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  manifestStatus(@Param('jobId') jobId: string) {
    return this.del.manifestStatus(jobId);
  }

  @Post('sync/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  sync(@Param('awb') awb: string) {
    return this.del.syncTracking(awb);
  }

  @Get('label/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  label(@Param('awb') awb: string) {
    return this.del.labelForAwb(awb);
  }

  @Post('cancel/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  cancel(@Param('awb') awb: string) {
    return this.del.cancelLr(awb);
  }

  @Post('pickup')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  pickup(@Body() dto: { warehouse?: string; date: string; startTime?: string; packages?: number }) {
    return this.del.createPickup(dto);
  }

  @Delete('pickup/:purId')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  cancelPickup(@Param('purId') purId: string) {
    return this.del.cancelPickup(purId);
  }
}
