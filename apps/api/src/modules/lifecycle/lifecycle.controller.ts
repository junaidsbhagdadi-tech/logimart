import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { LifecycleService } from './lifecycle.service';

const OPS = [UserRole.DRIVER, UserRole.WAREHOUSE_HANDLER, UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN];

@Controller('api/v1/lifecycle')
@UseGuards(RolesGuard)
export class LifecycleController {
  constructor(private readonly svc: LifecycleService) {}

  @Get('summary')
  @Roles(...OPS)
  summary() { return this.svc.summary(); }

  @Get('list')
  @Roles(...OPS)
  list(@Query('code') code?: string, @Query('limit') limit?: string) { return this.svc.list(code, limit ? Number(limit) : 100); }

  @Get('bags')
  @Roles(...OPS)
  bags() { return this.svc.bags(); }

  @Post('scan')
  @Roles(...OPS)
  scan(@Body() dto: { awbs: string[]; code: string; hubId?: number; remark?: string; podDataUrl?: string; bagCode?: string }, @Req() req: any) {
    return this.svc.scan(dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }

  @Post('bag')
  @Roles(...OPS)
  bag(@Body() dto: { bagCode: string; awbs: string[] }, @Req() req: any) {
    return this.svc.bag(dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }
}
