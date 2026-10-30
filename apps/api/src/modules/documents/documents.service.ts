import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

    // A shipment attachment (e.g. the invoice copy Delhivery requires) can unblock a refused hand-off → retry soon.
    if (meta.entityType === 'shipment') {
      await this.prisma.shipment.updateMany({ where: { id: BigInt(meta.entityId), bdError: { not: null }, forwardingAwb: null, bdWaybill: null }, data: { bdDispatchAt: null } }).catch(() => {});
    }
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

  /**
   * Invoice / e-way bill copies on a shipment (taken in the rider app or attached on the AWB page) are only
   * needed until delivery: once an AWB has been DELIVERED for 7 days (grace for CS / accounts queries) they are
   * deleted — the document row and its stored bytes. Hourly. DOC_PURGE_DAYS overrides the 7.
   * Box pictures go as soon as the AWB is delivered (no grace).
   */
  @Cron('15 * * * *', { timeZone: 'Asia/Kolkata' }) // hourly — box pictures go soon after delivery
  async purgeDeliveredDocs() {
    const days = Number(process.env.DOC_PURGE_DAYS ?? 7);
    if (!(days >= 0)) return { removed: 0 };
    const cutoff = new Date(Date.now() - days * 864e5);
    const docs = await this.prisma.document.findMany({
      where: { entityType: 'shipment', docType: { in: ['invoice', 'ewaybill', 'box'] } },
      select: { id: true, entityId: true, uploadId: true, docType: true },
    });
    if (!docs.length) return { removed: 0 };
    const delivered = await this.prisma.shipment.findMany({
      where: { id: { in: [...new Set(docs.map((d) => d.entityId))] }, statusCode: 'DLD' },
      select: { id: true, statusAt: true },
    });
    const at = new Map(delivered.map((x) => [String(x.id), x.statusAt]));
    const gone = docs.filter((d) => at.has(String(d.entityId)) && (d.docType === 'box' || +(at.get(String(d.entityId)) ?? 0) < +cutoff));
    if (!gone.length) return { removed: 0 };
    await this.prisma.document.deleteMany({ where: { id: { in: gone.map((d) => d.id) } } });
    await this.prisma.upload.deleteMany({ where: { id: { in: gone.map((d) => d.uploadId) } } }).catch(() => {});
    return { removed: gone.length };
  }
}
