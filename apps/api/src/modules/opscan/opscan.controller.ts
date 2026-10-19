import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { OpscanService } from './opscan.service';
import { PrismaService } from '../../prisma/prisma.service';
import { scopedClientIds } from '../../common/scope/data-scope';

@Controller('api/v1/opscan')
@UseGuards(RolesGuard)
export class OpscanController {
  constructor(private readonly svc: OpscanService, private readonly prisma: PrismaService) {}

  @Post()
  @Roles(UserRole.DRIVER, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  record(@Body() dto: { awb: string; eventType: string; serviceCenter?: string; remark?: string; notifyCustomer?: boolean }, @Req() req: any) {
    return this.svc.record(dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }

  @Get()
  @Roles(UserRole.DRIVER, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  async list(@Req() req: any, @Query('limit') limit?: string) {
    return this.svc.list(limit ? Number(limit) : 50, await scopedClientIds(this.prisma, req.user));
  }
}
