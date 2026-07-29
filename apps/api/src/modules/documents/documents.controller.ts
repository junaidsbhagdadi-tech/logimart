import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { DocumentsService } from './documents.service';

@Controller('api/v1/documents')
@UseGuards(RolesGuard)
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  /** Upload a KYC / agreement / insurance doc. Multipart field name: "file". */
  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @Body() body: any, @Req() req: any) {
    return this.docs.save(file, {
      entityType: body.entityType,
      entityId: Number(body.entityId),
      docType: body.docType,
      label: body.label,
      expiresAt: body.expiresAt,
      createdById: req.user?.sub ? Number(req.user.sub) : undefined,
    });
  }

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  list(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.docs.list(entityType, Number(entityId));
  }

  @Get(':id/file')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  async serve(@Param('id') id: string, @Res() res: Response) {
    const up = await this.docs.file(Number(id));
    res.setHeader('Content-Type', up.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(up.data));
  }

  @Delete(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  remove(@Param('id') id: string) {
    return this.docs.remove(Number(id));
  }
}
