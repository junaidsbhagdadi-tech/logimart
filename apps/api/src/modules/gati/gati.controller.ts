import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { GatiService } from './gati.service';

@Controller('api/v1/gati')
@UseGuards(RolesGuard)
export class GatiController {
  constructor(private readonly gati: GatiService) {}

  @Get('status')
  @Roles(UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  status() {
    return this.gati.status();
  }

  @Get('pincode/:pin')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.DRIVER)
  pincode(@Param('pin') pin: string) {
    return this.gati.pincode(pin);
  }

  /** Hand a Logimart shipment to Gati (docket + package series + pickup post). */
  @Post('handoff/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN, UserRole.DRIVER) // DRIVER: rider app hands its own bookings to the carrier
  handoff(@Param('awb') awb: string) {
    return this.gati.handoff(awb);
  }

  @Post('sync/:awb')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  sync(@Param('awb') awb: string) {
    return this.gati.syncTracking(awb);
  }

  @Post('cancel/:awb')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  cancel(@Param('awb') awb: string, @Body() dto?: { reason?: string }) {
    return this.gati.cancel(awb, dto?.reason);
  }

  /** Gati's docket print (A4 PDF) + package sticker links for a docket. */
  @Get('print/:docket')
  @Roles(UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN, UserRole.DRIVER)
  print(@Param('docket') docket: string) {
    return { docket, printUrl: this.gati.printUrl(docket), stickerUrl: this.gati.stickerUrl(docket) };
  }
}
