import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MastersService {
  constructor(private readonly prisma: PrismaService) {}

  list(type: string) {
    return this.prisma.masterEntry.findMany({ where: { type: type.toUpperCase() }, orderBy: { code: 'asc' } });
  }

  /** Add / update one master entry (code is the natural key within a type). */
  save(type: string, dto: { code: string; name: string; attrs?: any; active?: boolean }) {
    const t = type.toUpperCase();
    const code = String(dto.code).trim();
    const data = { name: String(dto.name ?? '').trim(), attrs: dto.attrs ?? {}, active: dto.active ?? true };
    return this.prisma.masterEntry.upsert({
      where: { type_code: { type: t, code } },
      update: data,
      create: { type: t, code, ...data },
    });
  }

  async remove(type: string, code: string) {
    await this.prisma.masterEntry.deleteMany({ where: { type: type.toUpperCase(), code } });
    return { ok: true };
  }
}
