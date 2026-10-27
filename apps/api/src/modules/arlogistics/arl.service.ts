import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { cityName } from '../../common/place-name';
import { deriveStatusFromBd } from '../bluedart/bd-status';

/**
 * AR Logistics Pvt Ltd (vendor ARL) — from "AR_Logistics_Pvt_API.pdf":
 *   POST https://api.arlogsolutionsindia.com/api/values        booking (CLCODE + PASS in the body) → consignment no.
 *   GET  https://api2.arlogsolutionsindia.com/api/commonapi/{cn} tracking (no auth)
 *   GET  https://api2.arlogsolutionsindia.com/api/imgscan/{cn}   POD image (no auth)
 * Env: ARL_CLCODE, ARL_PASS (the document only has the demo MICR / 0786), ARL_BOOK_URL / ARL_TRACK_URL / ARL_POD_URL.
 * The response formats aren't in the document — parsed defensively; verify on the first live call.
 */
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const A = {
  book: env('ARL_BOOK_URL', 'https://api.arlogsolutionsindia.com/api/values'),
  track: env('ARL_TRACK_URL', 'https://api2.arlogsolutionsindia.com/api/commonapi').replace(/\/$/, ''),
  pod: env('ARL_POD_URL', 'https://api2.arlogsolutionsindia.com/api/imgscan').replace(/\/$/, ''),
  code: env('ARL_CLCODE'),
  pass: env('ARL_PASS'),
};
export const arlConfigured = () => !!(A.code && A.pass);

const p2 = (n: number) => String(n).padStart(2, '0');
const ddmmyyyy = (d: Date) => { const t = new Date(d.getTime() + 330 * 60000); return `${p2(t.getUTCDate())}-${p2(t.getUTCMonth() + 1)}-${t.getUTCFullYear()}`; };

/** Walk any JSON and return the first value whose key matches. */
function pick(obj: any, re: RegExp): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const [k, v] of Object.entries(obj)) if (re.test(k) && v != null && v !== '') return v;
  for (const v of Object.values(obj)) { const r = typeof v === 'object' ? pick(v, re) : undefined; if (r !== undefined) return r; }
  return undefined;
}

@Injectable()
export class ArlService implements OnModuleInit {
  private readonly log = new Logger('ARLogistics');
  private syncing = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const mins = Number(process.env.ARL_SYNC_INTERVAL_MIN ?? 30);
    if (!(mins > 0)) return;
    const t = setInterval(() => this.autoSync().catch((e) => this.log.warn(`auto-sync: ${e?.message || e}`)), mins * 60_000);
    (t as any).unref?.();
  }

  status() { return { configured: arlConfigured(), clientCode: A.code || 'missing', password: A.pass ? 'set' : 'missing', bookUrl: A.book }; }

  private async fetchJson(url: string, init?: RequestInit) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) }).catch((e) => { throw new BadRequestException(`AR Logistics unreachable (${e?.cause?.code || e?.name || e}) — their server may need our IP 168.144.77.53 whitelisted.`); });
    const text = (await res.text()).trim();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new BadRequestException(`AR Logistics ${res.status}: ${String(text).slice(0, 250)}`);
    return data;
  }

  /** Book with AR → their consignment number becomes the forwarding AWB. */
  async handoff(awb: string) {
    if (!arlConfigured()) throw new BadRequestException('AR Logistics not configured — set ARL_CLCODE and ARL_PASS on the server.');
    const s: any = await this.prisma.shipment.findUnique({ where: { awb }, include: { pieces: true } });
    if (!s) throw new BadRequestException(`AWB ${awb} not found`);
    if (s.forwardingAwb) throw new BadRequestException(`${awb} already has a carrier AWB (${s.forwardingAwb}).`);
    const pins = await this.prisma.pincode.findMany({ where: { pincode: { in: [String(s.shipperPincode || ''), String(s.destPincode || '')] } }, select: { pincode: true, city: true } }).catch(() => [] as any[]);
    const city = async (pin: string, typed?: string | null) => (await cityName(this.prisma, pin, typed, pins.find((x: any) => x.pincode === pin)?.city)).toUpperCase().trim();
    const origin = await city(String(s.shipperPincode || ''), s.shipperCity);
    const dest = await city(String(s.destPincode || ''), s.consigneeCity);
    if (!origin || !dest || !s.consigneeName) throw new BadRequestException('AR Logistics needs origin city, destination city and consignee name on the AWB.');
    const volKg = (s.pieces ?? []).reduce((a: number, p: any) => a + Number(p.volKg || 0), 0);
    const r = await this.fetchJson(A.book, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        CLCODE: A.code, PASS: A.pass, BKDATE: ddmmyyyy(new Date(s.createdAt)), ORIGIN: origin, DESTINATION: dest,
        CONSIGNEE: String(s.consigneeName).slice(0, 60), INVNO: String(s.custInvoiceNo || s.referenceNo || s.awb).slice(0, 30),
        FVALUE: String(Number(s.declaredValue ?? s.shipmentValue ?? 0)), BWT: String(Number(s.totalDeadKg || 0.5)), VWT: String(+volKg.toFixed(2)),
        PKGS: String(s.pieceCount || 1), BMODE: /AIR/i.test(String(s.serviceMode)) ? 'A' : 'S',
      }),
    });
    const cn = String((typeof r === 'string' ? r.match(/[A-Z]{0,4}\d{5,}/)?.[0] : pick(r, /^(cn|cnno|cnote|docket|awb|consignment.?no|consignmentno|cons_no)$/i)) ?? '').trim();
    if (!cn) throw new BadRequestException(`AR Logistics did not return a consignment number: ${JSON.stringify(r).slice(0, 250)}`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { forwardingAwb: cn, vendor: s.vendor || 'ARL', bdStatus: 'Booked (AR Logistics)', bdHandedAt: new Date() } });
    return { awb, cn, response: r };
  }

  track(cn: string) { return this.fetchJson(`${A.track}/${encodeURIComponent(cn)}`); }

  async syncTracking(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { forwardingAwb: true, statusCode: true, podUrl: true } });
    if (!s?.forwardingAwb) throw new BadRequestException(`No AR Logistics consignment on ${awb} to track.`);
    const r = await this.track(s.forwardingAwb);
    const rows = Array.isArray(r) ? r : (pick(r, /^(data|tracking|details|result)$/i) ?? r);
    const last = Array.isArray(rows) ? rows[rows.length - 1] : rows;
    const status = String(pick(last, /status|activity|remarks?$/i) ?? (typeof r === 'string' ? r : '')).trim().slice(0, 120);
    const where = pick(last, /location|station|branch|city/i);
    const derived = status ? deriveStatusFromBd(s.statusCode, status) : null;
    const podUrl = derived?.statusCode === 'DLD' && !s.podUrl ? `${A.pod}/${encodeURIComponent(s.forwardingAwb)}` : undefined;
    await this.prisma.shipment.updateMany({ where: { awb }, data: { bdStatus: `${status || 'Booked'}${where ? ` — ${where}` : ''} (AR Logistics)`, ...(derived ? { statusCode: derived.statusCode, status: derived.status, statusAt: new Date() } : {}), ...(podUrl ? { podUrl } : {}) } });
    return { awb, cn: s.forwardingAwb, status, statusCode: derived?.statusCode ?? s.statusCode, tracking: r };
  }

  async autoSync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 864e5) }, forwardingAwb: { not: null },
          AND: [{ OR: [{ vendor: { equals: 'ARL', mode: 'insensitive' } }, { vendor: { contains: 'AR LOG', mode: 'insensitive' } }] }, { OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] }],
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
