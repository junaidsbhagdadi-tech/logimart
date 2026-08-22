import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Small inline files are capped; larger archives should be linked (fileUrl) to external storage.
const MAX_INLINE_BYTES = 25 * 1024 * 1024; // ~25 MB

@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  /** List archive items — metadata only (no file bytes). */
  async list(q?: { category?: string; fiscalYear?: string }) {
    const rows = await this.prisma.archiveItem.findMany({
      where: { category: q?.category || undefined, fiscalYear: q?.fiscalYear || undefined },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, category: true, fiscalYear: true, note: true, fileName: true, mimeType: true, sizeBytes: true, fileUrl: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, id: String(r.id), hasFile: false }));
  }

  async create(dto: any, userId?: bigint) {
    if (!dto.title?.trim()) throw new BadRequestException('Title is required.');
    if (!dto.fileData && !dto.fileUrl) throw new BadRequestException('Attach a file or provide an external link.');
    if (dto.fileData && Number(dto.sizeBytes || 0) > MAX_INLINE_BYTES) {
      throw new BadRequestException('File too large to store inline (max 25 MB). Upload it to Drive/Spaces and paste the link instead.');
    }
    const r = await this.prisma.archiveItem.create({
      data: {
        title: String(dto.title).trim(),
        category: dto.category || null,
        fiscalYear: dto.fiscalYear || null,
        note: dto.note || null,
        fileName: dto.fileName || null,
        mimeType: dto.mimeType || null,
        sizeBytes: dto.sizeBytes != null ? Number(dto.sizeBytes) : null,
        fileData: dto.fileData || null,
        fileUrl: dto.fileUrl || null,
        uploadedById: userId ?? null,
      },
      select: { id: true },
    });
    return { id: String(r.id) };
  }

  /** Fetch one item's file bytes (data URI) for download. */
  async file(id: string) {
    const r = await this.prisma.archiveItem.findUnique({ where: { id: BigInt(id) }, select: { fileName: true, mimeType: true, fileData: true, fileUrl: true } });
    if (!r) throw new BadRequestException('Not found.');
    return r;
  }

  async remove(id: string) {
    await this.prisma.archiveItem.delete({ where: { id: BigInt(id) } });
    return { deleted: true };
  }
}
