import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HubsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.hub.findMany({ orderBy: { code: 'asc' } });
  }

  /** Add / update a hub (code is the natural key, e.g. BLR). */
  create(dto: { code: string; name: string; zone: string }) {
    const code = dto.code.trim().toUpperCase();
    return this.prisma.hub.upsert({
      where: { code },
      update: { name: dto.name.trim(), zone: dto.zone.trim() },
      create: { code, name: dto.name.trim(), zone: dto.zone.trim() },
    });
  }
}
