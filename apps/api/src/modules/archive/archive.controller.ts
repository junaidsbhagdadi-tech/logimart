import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ArchiveService } from './archive.service';

/** Archived legacy data — SUPER ADMIN ONLY. */
@Controller('api/v1/archive')
@UseGuards(RolesGuard)
@Roles(UserRole.SYS_ADMIN)
export class ArchiveController {
  constructor(private readonly svc: ArchiveService) {}

  @Get()
  list(@Query('category') category?: string, @Query('fiscalYear') fiscalYear?: string) {
    return this.svc.list({ category, fiscalYear });
  }

  @Post()
  create(@Body() dto: any, @Req() req: any) {
    return this.svc.create(dto, req.user?.sub ? BigInt(req.user.sub) : undefined);
  }

  @Get(':id/file')
  file(@Param('id') id: string) {
    return this.svc.file(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
