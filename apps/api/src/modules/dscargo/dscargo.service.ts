import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveStatusFromBd } from '../bluedart/bd-status';

/**
 * DS Cargo — tracking only (no booking API). Open endpoint, no auth:
 *   GET https://authorcodesoftware.in/dsapi/tracking/Tracking/?AWBNo=<docket>  → JSON, or `null` if unknown.
 * The docket is the carrier AWB recorded at hand-off (shipment.forwardingAwb, vendor DSC).
 * Their "Status" text (e.g. "Forwarded To DELHI") goes through the shared carrier-status mapper.
 */
const TRACK_URL = (process.env.DSCARGO_TRACK_URL ?? 'https://authorcodesoftware.in/dsapi/tracking/Tracking/').trim();
export const isDsCargoVendor = (v?: string | null) => /^DSC$|DS\s*CARGO/i.test(String(v ?? '').trim());

@Injectable()
export class DsCargoService implements OnModuleInit {
  private readonly log = new Logger('DsCargo');
  private syncing = false;
  constructor(private readonly prisma: PrismaService) {}

  /** Refresh open DS Cargo shipments every DSCARGO_SYNC_INTERVAL_MIN (default 30; 0 = off). */
  onModuleInit() {
    const mins = Number(process.env.DSCARGO_SYNC_INTERVAL_MIN ?? 30);
    if (!(mins > 0)) return;
    const t = setInterval(() => this.autoSync().catch((e) => this.log.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (t as any).unref?.();
  }

  async track(docket: string) {
    const url = `${TRACK_URL}?AWBNo=${encodeURIComponent(docket.trim())}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    if (!res.ok) throw new BadRequestException(`DS Cargo tracking ${res.status}: ${text.slice(0, 200)}`);
    let data: any = null; try { data = JSON.parse(text); } catch { /* non-JSON */ }
    if (!data || typeof data !== 'object') throw new BadRequestException(`DS Cargo has no record of docket ${docket}.`);
    return data;
  }

  /** Pull the DS Cargo status onto the shipment (carrier text + our milestone). */
  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true, statusCode: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No DS Cargo docket on ${awb} — record it via "Forward to vendor" first.`);
    const d = await this.track(s.forwardingAwb);
    // Their Status is the source of truth (delivery_date is filled even before delivery).
    const status = String(d.Status || d.status || d.Return_Status || '').trim();
    const pod = d.POD_Remark || d.receiver_name;
    const label = `${status || 'Booked'}${pod ? ` — POD: ${pod}` : ''} (DS Cargo)`;
    const derived = status ? deriveStatusFromBd(s.statusCode, status) : null;
    await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus: label, ...(derived ? { statusCode: derived.statusCode, status: derived.status, statusAt: new Date() } : {}) } });
    return { awb, docket: s.forwardingAwb, status: label, statusCode: derived?.statusCode ?? s.statusCode, from: d.from_city, to: d.to_city, tracking: d };
  }

  async autoSync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 864e5) }, forwardingAwb: { not: null },
          AND: [
            { OR: [{ vendor: { equals: 'DSC', mode: 'insensitive' } }, { vendor: { contains: 'DS CARGO', mode: 'insensitive' } }] },
            { OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] },
          ],
        },
        select: { awb: true }, take: 300,
      });
      for (const r of rows) {
        try { await this.syncTracking(r.awb); } catch { /* keep going */ }
        await new Promise((res) => setTimeout(res, 300));
      }
    } finally {
      this.syncing = false;
    }
  }
}
