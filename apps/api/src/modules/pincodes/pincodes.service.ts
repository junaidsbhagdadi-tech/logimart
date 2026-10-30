import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { regionFromPincode } from '../../common/regions';
import { isCode, placeName } from '../../common/place-name';

@Injectable()
export class PincodesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a pincode → city/state/region/tier. Region always derivable. */
  async lookup(pincode: string) {
    const hit = await this.prisma.pincode.findUnique({ where: { pincode } });
    if (hit) return { ...hit, cityName: await this.fullCity(pincode, hit), known: true };
    const region = regionFromPincode(pincode);
    return { pincode, city: null, state: null, tier: null, isOda: false, region, known: false };
  }

  /**
   * The city as a NAME — the master's `city` is often a service-centre code (MTN, DEL). Prefer the name the
   * carriers' coverage lists use most for this pincode (e.g. "Cochin"), else metro name / area name.
   */
  private async fullCity(pincode: string, hit: { city: string | null; areaName: string | null }): Promise<string> {
    if (hit.city && !isCode(hit.city)) return hit.city.toUpperCase();
    const rows = await this.prisma.serviceablePincode.findMany({ where: { pincode }, select: { city: true } });
    const count = new Map<string, number>();
    for (const r of rows) { const c = String(r.city ?? '').trim().toUpperCase(); if (c && !isCode(c)) count.set(c, (count.get(c) ?? 0) + 1); }
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return best ?? placeName(null, hit);
  }

  /**
   * ODA or normal for ONE vendor at a destination (quick booking, after the carrier is picked). Reads that
   * vendor's coverage rows — a BlueDart account vendor reads the BDR / BLUEDART-* lists — narrowed to the
   * product's mode (air vs surface). No vendor = our own network (the pincode master's EDL flag).
   */
  async vendorOda(pincode: string, vendor?: string, product?: string) {
    const pin = String(pincode).trim();
    const master = await this.prisma.pincode.findUnique({ where: { pincode: pin } });
    const v = String(vendor ?? '').trim().toUpperCase();
    if (!v || v === 'SELF') {
      const oda = !!master && (master.isOda || String(master.edl ?? '').toUpperCase() === 'EDL');
      return { vendor: 'SELF', known: !!master, serviceable: !!master, isOda: oda, label: !master ? 'Not in pincode master' : oda ? 'ODA' : 'Normal', matches: [] as any[] };
    }
    const vrow = await this.prisma.vendor.findFirst({ where: { vendorCode: { equals: v, mode: 'insensitive' } }, select: { vendorCode: true, name: true } });
    const name = String(vrow?.name ?? '').toUpperCase();
    const isBd = /^(BDR|BLUE)/.test(v) || /BLUE ?DART|^BDR/.test(name);
    const nets = isBd ? null : [v, name].filter(Boolean);
    const rows = await this.prisma.serviceablePincode.findMany({
      where: { pincode: pin, ...(isBd ? { OR: [{ network: 'BDR' }, { network: { startsWith: 'BLUEDART' } }] } : { network: { in: nets!, mode: 'insensitive' } }) },
      select: { network: true, mode: true, isOda: true, isActive: true },
    });
    let surface: boolean | null = null;
    if (product) {
      const pm = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'PRODUCT', code: String(product).toUpperCase() } } }).catch(() => null);
      const g = String((pm?.attrs as any)?.groupType ?? '');
      if (g) surface = /SURF|ROAD|RAIL|TRAIN/i.test(g);
    }
    const isSurfaceRow = (r: { network: string; mode: string }) => /SURF|SFC|DARTPLUS|ROAD/i.test(`${r.mode} ${r.network}`);
    const fit = surface == null ? rows : rows.filter((r) => (surface ? isSurfaceRow(r) : !isSurfaceRow(r)));
    const use = fit.length ? fit : rows;
    const live = use.filter((r) => r.isActive);
    const oda = live.some((r) => r.isOda);
    return {
      vendor: vrow?.vendorCode ?? v, known: rows.length > 0, serviceable: live.length > 0, isOda: oda,
      label: !rows.length ? 'No coverage list for this vendor' : !live.length ? 'Not serviceable' : oda ? 'ODA' : 'Normal',
      matches: use.map((r) => ({ network: r.network, mode: r.mode, isOda: r.isOda, active: r.isActive })),
    };
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

  async serviceOptions(pincode: string, originPincode?: string) {
    const rows = await this.prisma.serviceablePincode.findMany({
      where: { pincode: pincode.trim(), isActive: true },
      orderBy: [{ tatDays: 'asc' }],
    });
    // One option per network × mode (a vendor's AIR and SURFACE coverage are separate rows).
    const byNet = new Map<string, { network: string; mode: string | null; tatDays: number | null; isOda: boolean; city: string | null }>();
    for (const r of rows) {
      const k = `${r.network}|${r.mode}`;
      if (!byNet.has(k)) byNet.set(k, { network: r.network, mode: r.mode || null, tatDays: r.tatDays, isOda: r.isOda, city: r.city });
    }
    let list: any[] = Array.from(byNet.values());
    // Fill any MISSING per-vendor TAT from the ZONE_TAT matrix (code <VENDOR>__<MODE> → SELF__<MODE>
    // → legacy <MODE>) when we know the origin — so a matrix update shows even if the serviceable row
    // has no tatDays. Existing row TATs are kept.
    // The uploaded ZONE_TAT matrix is AUTHORITATIVE for lane TAT — when we know the origin, a matrix
    // value overrides the coverage-row tatDays (and fills any that are null). Matched per vendor.
    if (originPincode) {
      const [o, d] = await Promise.all([
        this.prisma.pincode.findUnique({ where: { pincode: String(originPincode).trim() } }),
        this.prisma.pincode.findUnique({ where: { pincode: pincode.trim() } }),
      ]);
      const na = (s: any) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const zoneFor = (p: any, mm: string) => na(mm === 'SURFACE' ? p?.surfaceZone : p?.apexZone) || na(p?.region);
      const tatEntries = await this.prisma.masterEntry.findMany({ where: { type: 'ZONE_TAT' } });
      // Normalise stored codes "<VENDOR>__<MODE>" so "BLUE DART__SURFACE" and "BLUEDART__SURFACE" match.
      const naCode = (code: string) => code.toUpperCase().split('__').map((p) => p.replace(/[^A-Z0-9]/g, '')).join('__');
      const tatMap = new Map(tatEntries.map((e) => [naCode(e.code), (e.attrs as any)?.matrix]));
      // Map a serviceable network (e.g. "BLUEDART-APEX", "GATI") → the vendor codes the matrix is keyed
      // under (vendorCode/name), via the vendor master, so <vendor>__<mode> actually hits.
      const vendors = await this.prisma.vendor.findMany({ select: { name: true, vendorCode: true } });
      const vendorKeys = (network: string): string[] => {
        const nU = na(network);
        const base = na(String(network).split(/[-_ ]/)[0]); // "BLUEDART-APEX" -> "BLUEDART"
        const keys = new Set<string>([nU, base]);
        for (const v of vendors) {
          const code = na(v.vendorCode), nm = na(v.name);
          const hit = (code && (nU === code || base === code)) || (nm && (nU === nm || base === nm || nU.includes(nm) || (base && nm.includes(base))));
          if (hit) { if (code) keys.add(code); if (nm) keys.add(nm); }
        }
        return [...keys].filter(Boolean);
      };
      const matrixTat = (network: string, mode: string): number | null => {
        const mm = /AIR|APEX|EXP/i.test(mode) ? 'APEX' : 'SURFACE';
        const oz = zoneFor(o, mm), dz = zoneFor(d, mm);
        if (!oz || !dz) return null;
        for (const v of vendorKeys(network)) { const m = Number(tatMap.get(`${v}__${mm}`)?.[oz]?.[dz]); if (m > 0) return m; }
        for (const code of [`SELF__${mm}`, mm]) { const m = Number(tatMap.get(code)?.[oz]?.[dz]); if (m > 0) return m; }
        return null;
      };
      list = list.map((x) => { const mt = matrixTat(x.network, x.mode || ''); return { ...x, tatDays: mt ?? x.tatDays }; });
    }
    // Final fallback: a coverage row imported without a TAT (and not resolvable via the zone matrix)
    // borrows the fastest same-MODE committed TAT known for this destination, so it shows a transit
    // estimate instead of a blank "—". Flagged estimate:true (a genuine same-mode value, not fabricated).
    const modeTat = (mode: string | null): number | null => {
      const air = /AIR|APEX|EXP/i.test(String(mode ?? ''));
      const hits = list.filter((r) => (air ? /AIR|APEX|EXP/i : /SURF|ROAD|RAIL/i).test(String(r.mode ?? '')) && r.tatDays != null).map((r) => Number(r.tatDays));
      return hits.length ? Math.min(...hits) : null;
    };
    list = list.map((x) => (x.tatDays != null ? { ...x, estimate: false } : (() => { const t = modeTat(x.mode); return { ...x, tatDays: t, estimate: t != null }; })()));
    return list.sort((a, b) => (a.tatDays ?? 9999) - (b.tatDays ?? 9999));
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
    defaultMode = '',
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
    // Headers are matched ignoring case, spaces, "_", "-", "/" and "." — carrier files say "PIN CODE",
    // "Pin_Code", "ODA/EDL", "TAT Days" …
    const hk = (s: string) => String(s).toLowerCase().replace(/[\s_\-/.]/g, '');
    const field = (raw: any, ...names: string[]): any => {
      for (const n of names) for (const k of Object.keys(raw)) {
        if (hk(k) === hk(n)) { const v = raw[k]; if (v != null && String(v).trim() !== '') return v; }
      }
      return undefined;
    };
    const yes = (v: any) => v === true || /^(true|1|y|yes|oda|edl)$/i.test(String(v ?? '').trim());
    const no = (v: any) => v === false || /^(false|0|n|no|non ?serviceable|not ?serviceable)$/i.test(String(v ?? '').trim());
    // AIR / SURFACE / APEX / DP … — upper-cased; road/rail/sfc = SURFACE, express = AIR.
    const normMode = (v: any) => {
      const m = String(v ?? '').trim().toUpperCase();
      if (!m) return '';
      if (/^(SFC|SURFACE|ROAD|GROUND|RAIL|TRAIN)/.test(m)) return 'SURFACE';
      if (/^(AIR|EXPRESS)/.test(m)) return 'AIR';
      return m;
    };
    const CHUNK = 25;
    // Parse + validate every row up front (cheap, no DB). Only the coverage upsert runs per-row;
    // the base-directory sync is done once as a fast batched createMany afterwards, so a large file
    // (e.g. 21k pincodes) does ~half the DB round-trips and stays well under the gateway timeout.
    type Clean = { pincode: string; city: string | null; state: string | null; network: string; mode: string; tatDays: number | null; isOda: boolean; isActive: boolean };
    const clean: Clean[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      const pincode = String(field(raw, 'pincode', 'pin code', 'pin', 'pincodes', 'destination pincode', 'dest pincode', 'postal code') ?? '').trim().replace(/\.0+$/, '');
      if (!/^\d{6}$/.test(pincode)) { errors.push({ pincode: pincode || '(blank)', error: 'pincode must be 6 digits' }); continue; }
      const netRaw = field(raw, 'network');
      const network = String(netRaw || defaultNetwork).trim().toUpperCase() === 'SELF' ? 'SELF' : String(netRaw || defaultNetwork).trim();
      const isOda = yes(field(raw, 'isOda', 'oda', 'edl', 'oda/edl', 'oda edl', 'extended delivery', 'oda flag'));
      const tatRaw = field(raw, 'tatDays', 'tat', 'tat days', 'transit days', 'transit time');
      const tatDays = tatRaw != null && String(tatRaw).trim() !== '' && !isNaN(Number(tatRaw)) ? Number(tatRaw) : null;
      const city = String(field(raw, 'city', 'city name', 'destination city', 'location', 'area name', 'area') ?? '').trim() || null;
      const state = String(field(raw, 'state', 'state name') ?? '').trim() || null;
      const mode = normMode(field(raw, 'mode', 'service', 'service type', 'product') ?? defaultMode);
      const isActive = !no(field(raw, 'serviceable', 'isActive', 'active', 'status'));
      const key = `${pincode}|${network}|${mode}`;
      if (seen.has(key)) continue; // a file listing the same pincode twice → keep the first
      seen.add(key);
      clean.push({ pincode, city, state, network, mode, tatDays, isOda, isActive });
    }

    const doRow = async (r: Clean) => {
      try {
        await this.prisma.serviceablePincode.upsert({
          where: { pincode_network_mode: { pincode: r.pincode, network: r.network, mode: r.mode } },
          update: { city: r.city, state: r.state, tatDays: r.tatDays, isOda: r.isOda, isActive: r.isActive },
          create: { pincode: r.pincode, network: r.network, city: r.city, state: r.state, mode: r.mode, tatDays: r.tatDays, isOda: r.isOda, isActive: r.isActive },
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
