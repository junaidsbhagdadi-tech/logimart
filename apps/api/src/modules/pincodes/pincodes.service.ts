import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { regionFromPincode } from '../../common/regions';

@Injectable()
export class PincodesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a pincode → city/state/region/tier. Region always derivable. */
  async lookup(pincode: string) {
    const hit = await this.prisma.pincode.findUnique({ where: { pincode } });
    if (hit) return { ...hit, known: true };
    const region = regionFromPincode(pincode);
    return { pincode, city: null, state: null, tier: null, isOda: false, region, known: false };
  }

  search(q: string) {
    return this.prisma.pincode.findMany({
      where: {
        OR: [
          { city: { contains: q, mode: 'insensitive' } },
          { pincode: { startsWith: q } },
        ],
      },
      orderBy: [{ tier: 'asc' }, { city: 'asc' }],
      take: 20,
    });
  }

  /** Full serviceable-pincode list (master data screen). */
  list(limit = 200) {
    return this.prisma.pincode.findMany({ orderBy: [{ tier: 'asc' }, { city: 'asc' }], take: Math.min(limit, 1000) });
  }

  /** Add / update a serviceable pincode (city, state, region, tier, ODA). */
  create(dto: { pincode: string; city: string; state: string; region: any; tier: number; isOda?: boolean }) {
    const data = {
      city: dto.city.trim(),
      state: dto.state.trim(),
      region: dto.region,
      tier: Number(dto.tier),
      isOda: !!dto.isOda,
    };
    return this.prisma.pincode.upsert({
      where: { pincode: dto.pincode.trim() },
      update: data,
      create: { pincode: dto.pincode.trim(), ...data },
    });
  }
}
