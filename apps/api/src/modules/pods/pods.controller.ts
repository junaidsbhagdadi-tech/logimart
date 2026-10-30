import { Body, Controller, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PodsService } from './pods.service';
import { CreatePodDto } from './dto/create-pod.dto';

@Controller('api/v1/shipments')
@UseGuards(RolesGuard)
export class PodsController {
  constructor(private readonly pods: PodsService) {}

  /** Final delivery sign-off. ?force=true records a short delivery. */
  @Post(':awb/pod')
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(
    @Param('awb') awb: string,
    @Body() dto: CreatePodDto,
    @Req() req: any,
    @Query('force') force?: string,
  ) {
    return this.pods.createPod(awb, dto, BigInt(req.user.sub), force === 'true');
  }

  /** Bulk POD download (shipment list / track page) → a ZIP of POD images + e-POD pages + a summary CSV. */
  @Post('pods/zip')
  async podZip(@Body() dto: { awbs: string[] }, @Req() req: any, @Res() res: any) {
    const clientId = req.user.role === UserRole.CLIENT_ADMIN ? (req.user.clientId != null ? BigInt(req.user.clientId) : BigInt(-1)) : null;
    const r = await this.pods.bulkZip(dto?.awbs ?? [], clientId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="POD-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.setHeader('X-Pod-Count', String(r.count));
    res.end(r.zip);
  }

  /** #23b — Attach a POD image from the tracking page (no delivery sign-off). */
  @Post(':awb/pod-image')
  @Roles(UserRole.DRIVER, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  attachImage(@Param('awb') awb: string, @Body() dto: { dataUrl: string }) {
    return this.pods.attachPodImage(awb, dto?.dataUrl);
  }
}
