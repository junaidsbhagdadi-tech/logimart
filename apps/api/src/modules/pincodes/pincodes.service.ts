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
}
