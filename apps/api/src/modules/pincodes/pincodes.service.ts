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

  /** Directory completeness — total pincodes + how many carry each product zone (DP/Apex/Surface/Ecom). */
  async stats() {
    const [total, dp, apex, surface, ecom, oda, states] = await Promise.all([
      this.prisma.pincode.count(),
      this.prisma.pincode.count({ where: { dpZone: { not: null } } }),
      this.prisma.pincode.count({ where: { apexZone: { not: null } } }),
      this.prisma.pincode.count({ where: { surfaceZone: { not: null } } }),
      this.prisma.pincode.count({ where: { ecomZone: { not: null } } }),
      this.prisma.pincode.count({ where: { isOda: true } }),
      this.prisma.pincode.findMany({ distinct: ['state'], select: { state: true } }),
    ]);
    return { total, byProduct: { dp, apex, surface, ecom }, oda, states: states.length };
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

  /** Region (broad enum) from a granular zone code, e.g. NE1→NORTHEAST, N2→NORTH, W1→WEST. */
  private regionFromZone(z?: string | null): any {
    const s = String(z ?? '').trim().toUpperCase();
    if (s.startsWith('NE')) return 'NORTHEAST';
    if (s.startsWith('N')) return 'NORTH';
    if (s.startsWith('S')) return 'SOUTH';
    if (s.startsWith('E')) return 'EAST';
    if (s.startsWith('W')) return 'WEST';
    return null; // C (central) etc. — no matching Region enum
  }

  /**
   * Bulk upsert the pincode → per-product zone + EDL mapping (PINCODE MAPPING upload).
   * Row keys (case-insensitive): pincode, area/city, serviceCentre, areaName, state,
   * dpZone, surfaceZone, apexZone, ecomZone, edl, edlDistanceKm, tat(hours).
   */
  async bulkMapping(rows: any[]) {
    let ok = 0;
    const errors: { pincode: string; error: string }[] = [];
    const num = (v: any) => (v != null && String(v).trim() !== '' && !isNaN(Number(v)) ? Number(v) : null);
    for (const r of rows) {
      const pincode = String(r.pincode ?? '').trim();
      if (!/^\d{6}$/.test(pincode)) { errors.push({ pincode: pincode || '(blank)', error: 'pincode must be 6 digits' }); continue; }
      // Strip internal spaces so zones store as "NE1" (matches rate-card zones), not "NE 1".
      const zn = (v: any) => (v ? String(v).replace(/\s+/g, '').toUpperCase() : null);
      const surfaceZone = zn(r.surfaceZone);
      const apexZone = zn(r.apexZone);
      const edlRaw = String(r.edl ?? '').trim();
      const data: any = {
        city: (r.city ?? r.area ?? '').toString().trim() || 'NA',
        state: (r.state ?? '').toString().trim() || 'NA',
        serviceCentre: r.serviceCentre ? String(r.serviceCentre).trim() : null,
        areaName: r.areaName ? String(r.areaName).trim() : null,
        dpZone: zn(r.dpZone),
        surfaceZone, apexZone,
        ecomZone: zn(r.ecomZone),
        edl: edlRaw || 'Regular',
        edlDistanceKm: num(r.edlDistanceKm),
        tatHours: num(r.tat ?? r.tatHours),
        isOda: edlRaw !== '' && edlRaw.toUpperCase() !== 'REGULAR',
        region: this.regionFromZone(surfaceZone || apexZone),
      };
      try {
        await this.prisma.pincode.upsert({ where: { pincode }, update: data, create: { pincode, ...data } });
        ok++;
      } catch (e: any) { errors.push({ pincode, error: e.message }); }
    }
    return { imported: ok, failed: errors.length, errors: errors.slice(0, 50) };
  }

  // ============ serviceability coverage (SELF network / vendor-wise) ============

  /** Distinct networks present in the coverage table (for the filter dropdown). */
  async networks(): Promise<string[]> {
    const rows = await this.prisma.serviceablePincode.groupBy({ by: ['network'], orderBy: { network: 'asc' } });
    return rows.map((r) => r.network);
  }

  /** Which networks/products serve a pincode — one row per network, fastest TAT first. */
  /** Accurate lane TAT for an origin→destination pincode pair, from the ZONE_TAT matrix (per mode). */
  async laneTat(originPincode: string, destPincode: string) {
    const [o, d] = await Promise.all([
      this.prisma.pincode.findUnique({ where: { pincode: String(originPincode).trim() } }),
      this.prisma.pincode.findUnique({ where: { pincode: String(destPincode).trim() } }),
    ]);
    const norm = (z: any) => (z ? String(z).replace(/\s+/g, '').toUpperCase() : null);
    const zoneFor = (p: any, mode: string) => norm(mode === 'SURFACE' ? p?.surfaceZone : p?.apexZone) || norm(p?.region);
    // Fallback source: the destination's committed transit per network (ServiceablePincode).
    const destServ = await this.prisma.serviceablePincode.findMany({ where: { pincode: String(destPincode).trim(), isActive: true }, select: { mode: true, tatDays: true } });
    const servTat = (mode: string): number | null => {
      const hit = destServ
        .filter((r) => (mode === 'SURFACE' ? /SURF|ROAD|RAIL/i : /AIR|APEX|EXP/i).test(String(r.mode ?? '')) && r.tatDays != null)
        .map((r) => Number(r.tatDays));
      return hit.length ? Math.min(...hit) : null;
    };
    const lanes: { mode: string; originZone: string | null; destZone: string | null; tatDays: number | null; estimate: boolean }[] = [];
    for (const mode of ['APEX', 'SURFACE']) {
      const oz = zoneFor(o, mode), dz = zoneFor(d, mode);
      let days: number | null = null;
      if (oz && dz) {
        for (const code of [`SELF__${mode}`, mode]) {
          const entry = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'ZONE_TAT', code } } });
          const m = Number((entry?.attrs as any)?.matrix?.[oz]?.[dz]);
          if (m > 0) { days = m; break; }
        }
      }
      // Fall back to the destination's committed transit when the zone matrix has no entry for this lane.
      const estimate = days == null;
      if (days == null) days = servTat(mode);
      lanes.push({ mode: mode === 'APEX' ? 'AIR' : 'SURFACE', originZone: oz, destZone: dz, tatDays: days, estimate: estimate && days != null });
    }
    return {
      origin: { pincode: originPincode, city: o?.city ?? null, state: o?.state ?? null, region: o?.region ?? null, isOda: o?.isOda ?? false, known: !!o },
      dest: { pincode: destPincode, city: d?.city ?? null, state: d?.state ?? null, region: d?.region ?? null, isOda: d?.isOda ?? false, known: !!d },
      lanes,
    };
  }

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

  /** Per-vendor toggle: EDL/ODA (isOda) or serviceable/non-serviceable (isActive) for one pincode row. */
  async toggleServiceArea(id: number, patch: { isOda?: boolean; isActive?: boolean }) {
    const data: any = {};
    if (typeof patch.isOda === 'boolean') data.isOda = patch.isOda;
    if (typeof patch.isActive === 'boolean') data.isActive = patch.isActive;
    return this.prisma.serviceablePincode.update({ where: { id: BigInt(id) }, data });
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
    // Process in parallel chunks: a fully-sequential loop (2 upserts/row) on a large pincode file
    // ran for minutes and tripped the gateway timeout — the proxy then returned an HTML error page,
    // which the client tried to parse as JSON ("Unexpected token '<'"). Chunked concurrency keeps it
    // well under the timeout while staying gentle on the DB connection pool.
    // Read a field case-insensitively — the uploaded CSV header may be "Pincode"/"PINCODE"/"pincode",
    // "TatDays"/"tatdays", "isOda"/"ISODA", etc. Keying only on the exact lowercase name silently
    // dropped every row of a capital-header file (0 imported).
    const field = (raw: any, ...names: string[]): any => {
      for (const n of names) for (const k of Object.keys(raw)) {
        if (k.toLowerCase() === n.toLowerCase()) { const v = raw[k]; if (v != null && String(v).trim() !== '') return v; }
      }
      return undefined;
    };
    const CHUNK = 25;
    // Parse + validate every row up front (cheap, no DB). Only the coverage upsert runs per-row;
    // the base-directory sync is done once as a fast batched createMany afterwards, so a large file
    // (e.g. 21k pincodes) does ~half the DB round-trips and stays well under the gateway timeout.
    type Clean = { pincode: string; city: string | null; state: string | null; network: string; mode: string | null; tatDays: number | null; isOda: boolean };
    const clean: Clean[] = [];
    for (const raw of rows) {
      const pincode = String(field(raw, 'pincode') ?? '').trim();
      if (!/^\d{6}$/.test(pincode)) { errors.push({ pincode: pincode || '(blank)', error: 'pincode must be 6 digits' }); continue; }
      const netRaw = field(raw, 'network');
      const network = String(netRaw || defaultNetwork).trim().toUpperCase() === 'SELF' ? 'SELF' : String(netRaw || defaultNetwork).trim();
      const isOdaRaw = field(raw, 'isOda', 'oda');
      const isOda = isOdaRaw === true || String(isOdaRaw ?? '').trim().toLowerCase() === 'true' || String(isOdaRaw ?? '').trim() === '1';
      const tatRaw = field(raw, 'tatDays', 'tat', 'tatdays');
      const tatDays = tatRaw != null && String(tatRaw).trim() !== '' ? Number(tatRaw) : null;
      const city = String(field(raw, 'city') ?? '').trim() || null;
      const state = String(field(raw, 'state') ?? '').trim() || null;
      const mode = String(field(raw, 'mode') ?? '').trim() || null;
      clean.push({ pincode, city, state, network, mode, tatDays, isOda });
    }

    const doRow = async (r: Clean) => {
      try {
        await this.prisma.serviceablePincode.upsert({
          where: { pincode_network: { pincode: r.pincode, network: r.network } },
          update: { city: r.city, state: r.state, mode: r.mode, tatDays: r.tatDays, isOda: r.isOda, isActive: true },
          create: { pincode: r.pincode, network: r.network, city: r.city, state: r.state, mode: r.mode, tatDays: r.tatDays, isOda: r.isOda },
        });
        ok++;
      } catch (e: any) { errors.push({ pincode: r.pincode, error: e.message }); }
    };
    for (let i = 0; i < clean.length; i += CHUNK) {
      await Promise.all(clean.slice(i, i + CHUNK).map(doRow));
    }

    // Keep the base directory in sync so booking pincode-lookup resolves — batched insert of any
    // pincodes not already known (skipDuplicates), one deduped row per pincode.
    const baseSeen = new Set<string>();
    const baseRows = clean.filter((r) => r.city && r.state && !baseSeen.has(r.pincode) && baseSeen.add(r.pincode))
      .map((r) => ({ pincode: r.pincode, city: r.city!, state: r.state!, region: regionFromPincode(r.pincode) as any, tier: 2, isOda: r.isOda }));
    for (let i = 0; i < baseRows.length; i += 1000) {
      await this.prisma.pincode.createMany({ data: baseRows.slice(i, i + 1000), skipDuplicates: true }).catch(() => undefined);
    }
    return { imported: ok, failed: errors.length, errors: errors.slice(0, 50) };
  }
}
