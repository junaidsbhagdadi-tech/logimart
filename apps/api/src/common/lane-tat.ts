import { PrismaService } from '../prisma/prisma.service';

/**
 * Carrier standard transit (the ZONE_TAT matrices) + which deliveries can be measured. Shared by the SLA
 * report and the rate calculator so both judge "on time" the same way:
 *  - standard days = matrix <CARRIER>__<MODE> for the lane's zones (BlueDart account codes → BDR), else SELF__<MODE>;
 *  - a delivery is measurable when its delivered date is real: BlueDart (BlueDart's own scan date) or a shipment
 *    booked / handed off through the ERP (live-tracked). Bulk-imported shipments carry ~3-week EDDs and a
 *    back-filled "delivered" time, so they are NOT measured.
 */
export class LaneTat {
  private static vendors: { at: number; rows: { vendorCode: string | null; name: string }[] } | null = null;
  private static matrices: { at: number; m: Map<string, any> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  static isSurfaceProduct(product?: string | null) { return ['SFC', 'TOSFC', 'SURFACE', 'HUB', 'FTL'].includes(String(product ?? '').toUpperCase()); }
  static mode(product?: string | null) { return LaneTat.isSurfaceProduct(product) ? 'SURFACE' : 'APEX'; }
  /** Calendar days (IST) from booking to delivery. */
  static days(createdAt: Date, deliveredAt: Date) {
    const d = (x: Date) => Math.floor((+new Date(x) + 330 * 60000) / 864e5);
    return d(deliveredAt) - d(createdAt);
  }

  private async vendorList() {
    if (!LaneTat.vendors || Date.now() - LaneTat.vendors.at > 10 * 60_000) LaneTat.vendors = { at: Date.now(), rows: await this.prisma.vendor.findMany({ select: { vendorCode: true, name: true } }) };
    return LaneTat.vendors!.rows;
  }

  /** Carrier key for the transit tables / history: every BlueDart account code (and BDR) is "BDR". */
  async carrierKey(code?: string | null): Promise<string> {
    const c = String(code ?? '').toUpperCase();
    if (!c || c === 'SELF' || c === 'LOGM') return 'SELF';
    const v = (await this.vendorList()).find((x) => String(x.vendorCode).toUpperCase() === c);
    const isBd = /^BDR$/i.test(v?.vendorCode ?? c) || /^(BDR|BD )|BLUE ?DART/i.test(v?.name ?? '');
    return isBd ? 'BDR' : c;
  }

  async standardTat(carrier: string, mode: string, oz?: string | null, dz?: string | null): Promise<number | null> {
    if (!oz || !dz) return null;
    if (!LaneTat.matrices || Date.now() - LaneTat.matrices.at > 30 * 60_000) {
      const rows = await this.prisma.masterEntry.findMany({ where: { type: 'ZONE_TAT' }, select: { code: true, attrs: true } });
      LaneTat.matrices = { at: Date.now(), m: new Map(rows.map((r) => [r.code.toUpperCase(), (r.attrs as any)?.matrix ?? {}])) };
    }
    for (const code of [`${carrier}__${mode}`, `SELF__${mode}`, mode]) {
      const d = Number(LaneTat.matrices.m.get(code)?.[oz]?.[dz]);
      if (d > 0) return d;
    }
    return null;
  }

  /** Lane zones from pincodes, per mode (surface → surfaceZone, else apexZone). `pins` map is a bulk lookup. */
  static zone(pin: { surfaceZone?: string | null; apexZone?: string | null } | null | undefined, surface: boolean) {
    const v = surface ? pin?.surfaceZone : pin?.apexZone;
    return v ? String(v).replace(/\s+/g, '').toUpperCase() : null;
  }

  async pinZones(pincodes: (string | null | undefined)[]) {
    const uniq = [...new Set(pincodes.filter((p): p is string => !!p && /^\d{6}$/.test(p)))];
    const out = new Map<string, { surfaceZone: string | null; apexZone: string | null }>();
    for (let i = 0; i < uniq.length; i += 5000) {
      for (const r of await this.prisma.pincode.findMany({ where: { pincode: { in: uniq.slice(i, i + 5000) } }, select: { pincode: true, surfaceZone: true, apexZone: true } })) out.set(r.pincode, r);
    }
    return out;
  }

  /** Whether a delivered shipment's delivered date can be trusted. */
  static measurable(carrierKey: string, s: { awb?: string | null; bdHandedAt?: Date | null }) {
    return carrierKey === 'BDR' || String(s.awb ?? '').startsWith('L') || !!s.bdHandedAt;
  }
}
