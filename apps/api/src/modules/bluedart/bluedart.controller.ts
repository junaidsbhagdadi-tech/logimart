import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { BluedartService } from './bluedart.service';

@Controller('api/v1/bluedart')
@UseGuards(RolesGuard)
export class BluedartController {
  constructor(private readonly bd: BluedartService) {}

  /** Config health — safe to call unconfigured (returns configured:false). */
  @Get('status')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  status() {
    return this.bd.status();
  }

  /** Force a fresh JWT (auth smoke-test once credentials are set). */
  @Get('token/test')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async token() {
    const t = await this.bd.getToken(true);
    return { ok: true, tokenPreview: t.slice(0, 12) + '…' };
  }

  @Get('serviceable/:pincode')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  serviceable(@Param('pincode') pincode: string) {
    return this.bd.serviceability(pincode);
  }

  @Get('track/:awb')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  track(@Param('awb') awb: string) {
    return this.bd.track(awb);
  }

  /** Hand a Logimart shipment off to BlueDart (generate waybill). */
  @Post('handoff/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  handoff(@Param('awb') awb: string) {
    return this.bd.generateWaybill(awb);
  }

  @Post('sync/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  sync(@Param('awb') awb: string) {
    return this.bd.syncTracking(awb);
  }

  /** Cancel a BlueDart waybill (before manifest/in-scan). */
  @Post('cancel/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  cancel(@Param('awb') awb: string) {
    return this.bd.cancelWaybill(awb);
  }

  /** BlueDart official AWB print (base64) captured at hand-off. */
  @Get('label/:awb')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  label(@Param('awb') awb: string) {
    return this.bd.label(awb);
  }

  @Post('pickup')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  pickup(@Body() body: any) {
    return this.bd.registerPickup(body);
  }

  /** Schedule a BlueDart pickup for a shipment (maps the shipper address from the shipment). */
  @Post('pickup/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  schedulePickup(@Param('awb') awb: string, @Body() body: { date?: string; time?: string; remarks?: string }) {
    return this.bd.schedulePickup(awb, body || {});
  }
}
