import { Body, Controller, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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

  /** #23b — Attach a POD image from the tracking page (no delivery sign-off). */
  @Post(':awb/pod-image')
  @Roles(UserRole.DRIVER, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  attachImage(@Param('awb') awb: string, @Body() dto: { dataUrl: string }) {
    return this.pods.attachPodImage(awb, dto?.dataUrl);
  }
}
