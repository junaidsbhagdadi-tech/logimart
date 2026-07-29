import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/v1/audit')
@UseGuards(RolesGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles(UserRole.SYS_ADMIN)
  list(@Query('entity') entity?: string, @Query('limit') limit?: string) {
    return this.prisma.auditLog.findMany({
      where: entity ? { entity } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit ? Number(limit) : 200, 500),
    });
  }
}
