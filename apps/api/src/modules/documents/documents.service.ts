import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const ENTITIES = ['client', 'vendor', 'shipment'];

export interface SaveDocMeta {
  entityType: string;
  entityId: number;
  docType: string;
  label?: string;
  expiresAt?: string;
  createdById?: number;
}

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(file: Express.Multer.File, meta: SaveDocMeta) {
    if (!file) throw new BadRequestException('No file provided');
    if (!ALLOWED.includes(file.mimetype)) throw new BadRequestException(`Unsupported type ${file.mimetype} (PDF or image only)`);
    if (file.size > MAX_BYTES) throw new BadRequestException('File too large (max 12 MB)');
    if (!ENTITIES.includes(meta.entityType)) throw new BadRequestException('entityType must be client | vendor | shipment');
    if (!meta.entityId) throw new BadRequestException('entityId is required');

    const up = await this.prisma.upload.create({
      data: { kind: 'document', mimeType: file.mimetype, sizeBytes: file.size, data: file.buffer },
      select: { id: true },
    });
    return this.prisma.document.create({
      data: {
        entityType: meta.entityType,
        entityId: BigInt(meta.entityId),
        docType: meta.docType || 'other',
        label: meta.label,
        uploadId: up.id,
        expiresAt: meta.expiresAt ? new Date(meta.expiresAt) : null,
        createdById: meta.createdById != null ? BigInt(meta.createdById) : null,
      },
    });
  }

  async list(entityType: string, entityId: number) {
    const docs = await this.prisma.document.findMany({
      where: { entityType, entityId: BigInt(entityId), status: { not: 'archived' } },
      orderBy: { createdAt: 'desc' },
    });
    const uploads = await this.prisma.upload.findMany({
      where: { id: { in: docs.map((d) => d.uploadId) } },
      select: { id: true, mimeType: true, sizeBytes: true },
    });
    const byId = new Map(uploads.map((u) => [String(u.id), u]));
    const today = new Date();
    return docs.map((d) => ({
      ...d,
      url: `/api/v1/documents/${d.id}/file`,
      mimeType: byId.get(String(d.uploadId))?.mimeType ?? null,
      sizeBytes: byId.get(String(d.uploadId))?.sizeBytes ?? null,
      isExpired: d.expiresAt ? new Date(d.expiresAt) < today : false,
    }));
  }

  async file(id: number) {
    const doc = await this.prisma.document.findUnique({ where: { id: BigInt(id) } });
    if (!doc) throw new NotFoundException('Document not found');
    const up = await this.prisma.upload.findUnique({ where: { id: doc.uploadId } });
    if (!up) throw new NotFoundException('File not found');
    return up;
  }

  async remove(id: number) {
    const doc = await this.prisma.document.findUnique({ where: { id: BigInt(id) } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.document.update({ where: { id: doc.id }, data: { status: 'archived' } });
    return { id, archived: true };
  }
}
