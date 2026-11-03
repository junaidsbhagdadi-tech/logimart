import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RateService } from './rate.service';
import { opsJob } from '../../common/ops-hooks';

const MAX_AGE_MS = 6 * 3600_000; // an un-invoiced price is re-rated after this (rate cards / weights change)
const PAGE = 300;
const CONC = 12;

export type ShipPrice = { freight: number; fuel: number; other: number; subtotal: number; basis: string; vendorCost: number | null; vendorBasis: string | null };

/**
 * Per-shipment price cache behind the reports. Sell = the invoice line once billed, else the rate engine;
 * vendor amount = the uploaded vendor bill, else the vendor's own cost card for that vendor. A background
 * pass keeps the last ~70 days warm; reports call ensure() for their range (bounded, so a request never
 * re-rates a whole year at once).
 */
@Injectable()
export class PriceCacheService implements OnModuleInit {
  private readonly log = new Logger('PriceCache');
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly rates: RateService) {}

  onModuleInit() {
    if (String(process.env.PRICE_CACHE ?? 'true').toLowerCase() === 'false') return;
    const t = setInterval(() => opsJob('Report price cache', () => this.refreshRecent(), (r) => `${r.priced} priced, ${r.pending} pending`).catch((e) => this.log.warn(`refresh: ${e?.message || e}`)), 15 * 60_000);
    (t as any).unref?.();
    setTimeout(() => this.refreshRecent().catch(() => undefined), 3 * 60_000);
  }

  /** Background pass: shipments booked in the last 70 days whose price is missing / stale. */
  async refreshRecent(limit = 4000) {
    if (this.running) return { priced: 0, pending: 0 };
    this.running = true;
    try {
      const ids = (await this.prisma.shipment.findMany({ where: { createdAt: { gte: new Date(Date.now() - 70 * 864e5) } }, select: { id: true } })).map((x) => x.id);
      return await this.ensure(ids, limit);
    } finally { this.running = false; }
  }

  /** Make sure these shipments have a fresh price (at most `limit` re-rated now) and return them all. */
  async ensure(ids: bigint[], limit = 2500): Promise<{ priced: number; pending: number; prices: Map<string, ShipPrice> }> {
    const prices = new Map<string, ShipPrice>();
    if (!ids.length) return { priced: 0, pending: 0, prices };
    const stale: bigint[] = [];
    const cutoff = Date.now() - MAX_AGE_MS;
    for (let i = 0; i < ids.length; i += 5000) {
      const chunk = ids.slice(i, i + 5000);
      const [rows, billed] = await Promise.all([
        this.prisma.shipmentPrice.findMany({ where: { shipmentId: { in: chunk } } }),
        this.prisma.invoiceLineItem.findMany({ where: { shipmentId: { in: chunk } }, select: { shipmentId: true } }),
      ]);
      const billedSet = new Set(billed.map((b) => b.shipmentId.toString()));
      const have = new Map(rows.map((r) => [r.shipmentId.toString(), r]));
      for (const id of chunk) {
        const r = have.get(id.toString());
        // stale: never priced, an estimate that has since been invoiced, or an old estimate
        if (!r || (r.basis !== 'INVOICE' && billedSet.has(id.toString())) || (r.basis !== 'INVOICE' && +r.computedAt < cutoff)) stale.push(id);
        if (r) prices.set(id.toString(), this.toPrice(r));
      }
    }
    const now = stale.slice(0, limit);
    for (let p = 0; p < now.length; p += PAGE) {
      for (const [k, v] of await this.priceMany(now.slice(p, p + PAGE))) prices.set(k, v);
    }
    return { priced: now.length, pending: stale.length - now.length, prices };
  }

  private toPrice(r: any): ShipPrice {
    return { freight: Number(r.freight), fuel: Number(r.fuel), other: Number(r.other), subtotal: Number(r.subtotal), basis: r.basis, vendorCost: r.vendorCost != null ? Number(r.vendorCost) : null, vendorBasis: r.vendorBasis ?? null };
  }

  /** Price one page of shipments and store the results. */
  private async priceMany(ids: bigint[]) {
    const out = new Map<string, ShipPrice>();
    const ships = await this.prisma.shipment.findMany({
      where: { id: { in: ids } },
      include: {
        pieces: { select: { status: true, deadKg: true, volKg: true, lengthCm: true, widthCm: true, heightCm: true } },
        invoiceLines: { select: { freight: true, fuel: true, otherCharges: true, amount: true }, take: 1 },
      },
    });
    // vendor bills for this page, matched by our AWB / forwarding no / BlueDart waybill
    const keys = [...new Set(ships.flatMap((s: any) => [s.awb, s.forwardingAwb, s.bdWaybill]).filter(Boolean).map((k: any) => String(k).trim().toUpperCase()))];
    const bills = keys.length ? await this.prisma.vendorBill.findMany({ where: { OR: [{ awb: { in: keys } }, { forwardingNo: { in: keys } }] }, select: { awb: true, forwardingNo: true, total: true } }) : [];
    const billBy = new Map<string, number>();
    for (const b of bills) for (const k of [b.awb, b.forwardingNo]) if (k) billBy.set(String(k).trim().toUpperCase(), (billBy.get(String(k).trim().toUpperCase()) ?? 0) + Number(b.total || 0));

    const one = async (s: any) => {
      let p: ShipPrice;
      const line = s.invoiceLines?.[0];
      if (line) {
        p = { freight: Number(line.freight), fuel: Number(line.fuel), other: Number(line.otherCharges), subtotal: Number(line.amount), basis: 'INVOICE', vendorCost: null, vendorBasis: null };
      } else if (String(s.statusCode || '') === 'CAN') {
        p = { freight: 0, fuel: 0, other: 0, subtotal: 0, basis: 'NONE', vendorCost: null, vendorBasis: null };
      } else {
        const b: any = await this.rates.chargesForShipment(s, s.pieces).catch(() => null);
        const sub = Number(b?.subtotal ?? 0), fr = Number(b?.freight ?? 0), fu = Number(b?.fuel ?? 0);
        p = b ? { freight: fr, fuel: fu, other: +(sub - fr - fu).toFixed(2), subtotal: sub, basis: 'RATE', vendorCost: null, vendorBasis: null }
          : { freight: 0, fuel: 0, other: 0, subtotal: 0, basis: 'NONE', vendorCost: null, vendorBasis: null };
      }
      // vendor amount: the actual vendor bill, else the vendor's own cost card for this lane
      const billed = [s.awb, s.forwardingAwb, s.bdWaybill].map((k) => (k ? billBy.get(String(k).trim().toUpperCase()) : undefined)).find((v) => v != null);
      if (billed != null) { p.vendorCost = +billed.toFixed(2); p.vendorBasis = 'BILL'; }
      else if (s.vendor && s.product && String(s.statusCode || '') !== 'CAN') {
        const kg = Number(s.chargeWeight ?? 0) || Math.max(Number(s.totalDeadKg ?? 0), Number(s.totalVolKg ?? 0)) || 0.5;
        const opts = await this.rates.vendorCostOptions({ product: s.product, originZone: s.originZone, destZone: s.destZone, kg, bookedAt: s.createdAt }).catch(() => [] as { vendor: string; subtotal: number }[]);
        const mine = opts.find((o) => o.vendor === String(s.vendor).toUpperCase());
        if (mine) { p.vendorCost = mine.subtotal; p.vendorBasis = 'CARD'; }
      }
      out.set(s.id.toString(), p);
      const data = {
        freight: new Prisma.Decimal(p.freight.toFixed(2)), fuel: new Prisma.Decimal(p.fuel.toFixed(2)), other: new Prisma.Decimal(p.other.toFixed(2)),
        subtotal: new Prisma.Decimal(p.subtotal.toFixed(2)), basis: p.basis,
        vendorCost: p.vendorCost != null ? new Prisma.Decimal(p.vendorCost.toFixed(2)) : null, vendorBasis: p.vendorBasis, computedAt: new Date(),
      };
      await this.prisma.shipmentPrice.upsert({ where: { shipmentId: s.id }, update: data, create: { shipmentId: s.id, ...data } }).catch(() => undefined);
    };
    for (let i = 0; i < ships.length; i += CONC) await Promise.all(ships.slice(i, i + CONC).map(one));
    return out;
  }
}
