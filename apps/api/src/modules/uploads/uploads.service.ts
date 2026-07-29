import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(file: Express.Multer.File, kind: string) {
    if (!file) throw new BadRequestException('No file provided');
    if (!ALLOWED.includes(file.mimetype)) throw new BadRequestException(`Unsupported type ${file.mimetype}`);
    if (file.size > MAX_BYTES) throw new BadRequestException('File too large (max 8 MB)');

    const up = await this.prisma.upload.create({
      data: { kind, mimeType: file.mimetype, sizeBytes: file.size, data: file.buffer },
      select: { id: true, mimeType: true, sizeBytes: true },
    });
    return { id: up.id, url: `/api/v1/uploads/${up.id}`, mimeType: up.mimeType, sizeBytes: up.sizeBytes };
  }

  async get(id: number) {
    const up = await this.prisma.upload.findUnique({ where: { id: BigInt(id) } });
    if (!up) throw new NotFoundException('File not found');
    return up;
  }
}
