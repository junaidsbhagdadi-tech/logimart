import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ClaimsService } from './claims.service';
import { CreateClaimDto, ReviewClaimDto, SettleClaimDto } from './dto/claims.dto';

@Controller('api/v1/claims')
@UseGuards(RolesGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.CLIENT_ADMIN, UserRole.SYS_ADMIN)
  create(@Body() dto: CreateClaimDto, @Req() req: any) {
    return this.claims.create({ ...dto, createdById: req.user?.sub ? Number(req.user.sub) : undefined });
  }

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  list(@Query('status') status?: string) {
    return this.claims.list(status);
  }

  @Get(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  get(@Param('id') id: string) {
    return this.claims.get(Number(id));
  }

  @Post(':id/review')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  review(@Param('id') id: string, @Body() dto: ReviewClaimDto) {
    return this.claims.review(Number(id), dto.status, dto.resolution);
  }

  @Post(':id/settle')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  settle(@Param('id') id: string, @Body() dto: SettleClaimDto) {
    return this.claims.settle(Number(id), dto.approvedAmount, dto.resolution);
  }
}
