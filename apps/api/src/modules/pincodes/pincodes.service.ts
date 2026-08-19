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

  // ============ serviceability coverage (SELF network / vendor-wise) ============

  /** Distinct networks present in the coverage table (for the filter dropdown). */
  async networks(): Promise<string[]> {
    const rows = await this.prisma.serviceablePincode.groupBy({ by: ['network'], orderBy: { network: 'asc' } });
    return rows.map((r) => r.network);
  }

  /** Which networks/products serve a pincode — one row per network, fastest TAT first. */
  async serviceOptions(pincode: string) {
    const rows = await this.prisma.serviceablePincode.findMany({
      where: { pincode: pincode.trim(), isActive: true },
      orderBy: [{ tatDays: 'asc' }],
    });
    const byNet = new Map<string, { network: string; mode: string | null; tatDays: number | null; isOda: boolean; city: string | null }>();
    for (const r of rows) {
      if (!byNet.has(r.network)) byNet.set(r.network, { network: r.network, mode: r.mode, tatDays: r.tatDays, isOda: r.isOda, city: r.city });
    }
    return Array.from(byNet.values()).sort((a, b) => (a.tatDays ?? 9999) - (b.tatDays ?? 9999));
  }

  /** Coverage list, optionally filtered to one network (SELF or a vendor). */
  listServiceAreas(network?: string, limit = 500) {
    return this.prisma.serviceablePincode.findMany({
      where: network ? { network } : undefined,
      orderBy: [{ network: 'asc' }, { pincode: 'asc' }],
      take: Math.min(limit, 5000),
    });
  }

  /**
   * Bulk upsert serviceable pincodes for a network. Each row: pincode (required),
   * plus optional city/state/mode/tatDays/isOda; network defaults to the row's
   * `network` or the request-level `defaultNetwork` or 'SELF'. Also mirrors the
   * base pincode into the Pincode directory (region derived) so booking lookups work.
   */
  async bulkServiceAreas(
    rows: Array<{ pincode?: string; city?: string; state?: string; network?: string; mode?: string; tatDays?: string | number; isOda?: string | boolean }>,
    defaultNetwork = 'SELF',
  ) {
    let ok = 0;
    const errors: { pincode: string; error: string }[] = [];
    for (const raw of rows) {
      const pincode = String(raw.pincode ?? '').trim();
      if (!/^\d{6}$/.test(pincode)) { errors.push({ pincode: pincode || '(blank)', error: 'pincode must be 6 digits' }); continue; }
      const network = String(raw.network || defaultNetwork).trim().toUpperCase() === 'SELF' ? 'SELF' : String(raw.network || defaultNetwork).trim();
      const isOda = raw.isOda === true || String(raw.isOda ?? '').trim().toLowerCase() === 'true' || String(raw.isOda ?? '').trim() === '1';
      const tatDays = raw.tatDays != null && String(raw.tatDays).trim() !== '' ? Number(raw.tatDays) : null;
      const city = raw.city?.toString().trim() || null;
      const state = raw.state?.toString().trim() || null;
      const mode = raw.mode?.toString().trim() || null;
      try {
        await this.prisma.serviceablePincode.upsert({
          where: { pincode_network: { pincode, network } },
          update: { city, state, mode, tatDays, isOda, isActive: true },
          create: { pincode, network, city, state, mode, tatDays, isOda },
        });
        // keep the base directory in sync so booking pincode-lookup resolves
        if (city && state) {
          await this.prisma.pincode.upsert({
            where: { pincode },
            update: { city, state, isOda: isOda || undefined },
            create: { pincode, city, state, region: regionFromPincode(pincode) as any, tier: 2, isOda },
          }).catch(() => undefined);
        }
        ok++;
      } catch (e: any) { errors.push({ pincode, error: e.message }); }
    }
    return { imported: ok, failed: errors.length, errors: errors.slice(0, 50) };
  }
}
