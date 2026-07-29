import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { UploadsService } from './uploads.service';

@Controller('api/v1/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Upload a POD image (signature / stamp photo). Field name: "file". */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @Query('kind') kind?: string) {
    return this.uploads.save(file, kind || 'pod_stamp');
  }

  /** Serve the stored image. Public by opaque id (used in <img> tags). */
  @Get(':id')
  async serve(@Param('id') id: string, @Res() res: Response) {
    const up = await this.uploads.get(Number(id));
    res.setHeader('Content-Type', up.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(up.data));
  }
}
