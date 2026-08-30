import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChargeBreakup } from './rate.service';

const r2 = (n: number) => +n.toFixed(2);

/**
 * ALTERNATIVE freight engine: price per BOX, where each box's rate comes from the WEIGHT slab
 * (0-15kg, 16-30kg…) its own weight falls into; freight = the sum across the shipment's boxes.
 * Active when the customer×product has a PerBoxRateCard. Fully isolated from the weight engine —
 * it produces
 * the same ChargeBreakup shape, so the shared downstream pipeline (per-customer other charges,
 * overrides, GST) runs on top unchanged. Returns null when no per-box card applies, so the
 * weight engine takes over exactly as before.
 */
@Injectable()
export class PerBoxService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- management (CRUD) ----
  listCards(clientId: number) {
    return this.prisma.perBoxRateCard.findMany({
      where: { clientId: BigInt(clientId) },
      include: { slabs: { orderBy: { fromKg: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  createCard(dto: any) {
    return this.prisma.perBoxRateCard.create({
      data: {
        clientId: BigInt(dto.clientId),
        network: String(dto.network || 'SELF').toUpperCase(),
        product: String(dto.product),
        fuelPct: Number(dto.fuelPct) || 0,
        fovPct: Number(dto.fovPct) || 0,
        odaFlat: Number(dto.odaFlat) || 0,
        odaMin: Number(dto.odaMin) || 0,
        slabs: { create: (dto.slabs || []).map((s: any) => ({ fromKg: Number(s.fromKg) || 0, toKg: Number(s.toKg) || 0, perBox: Number(s.perBox) || 0 })) },
      },
      include: { slabs: true },
    });
  }

  async removeCard(id: number) {
    await this.prisma.perBoxRateCard.delete({ where: { id: BigInt(id) } });
    return { ok: true };
  }

  async tryPrice(shipment: any, pieces: any[]): Promise<ChargeBreakup | null> {
    const clientId = shipment?.clientId;
    const product = shipment?.product;
    if (clientId == null || !product) return null;

    const cards = await this.prisma.perBoxRateCard.findMany({
      where: { clientId: BigInt(clientId), product: String(product), isActive: true },
      include: { slabs: { orderBy: { fromKg: 'asc' } } },
    });
    if (!cards.length) return null;

    // Prefer a card whose network matches the shipment's vendor, else SELF, else the first.
    const vendor = String(shipment.vendor || 'SELF').toUpperCase();
    const card = cards.find((c) => (c.network || '').toUpperCase() === vendor)
      || cards.find((c) => (c.network || 'SELF').toUpperCase() === 'SELF')
      || cards[0];
    if (!card.slabs.length) return null;

    // Each BOX is priced by the WEIGHT slab it falls into (its own dead/vol weight); freight = sum.
    const sorted = [...card.slabs].sort((a, b) => Number(a.fromKg) - Number(b.fromKg));
    const topSlab = sorted[sorted.length - 1];
    const boxes = (pieces && pieces.length ? pieces : Array.from({ length: Number(shipment.pieceCount) || 1 }, () => ({ deadKg: 0.5, volKg: 0 })));
    const boxKg = (p: any) => Math.max(Number(p.deadKg) || 0, Number(p.volKg) || 0) || 0.001;
    let freight = 0;
    for (const p of boxes) {
      const w = boxKg(p);
      const slab = sorted.find((s) => w >= Number(s.fromKg) && w <= Number(s.toKg)) || topSlab; // heavier than the top slab → top rate
      freight += Number(slab.perBox);
    }
    freight = r2(freight);
    const pcs = boxes.length;
    const perBox = pcs ? r2(freight / pcs) : 0; // effective average, for the line label

    // Accessorials on top — identical formulas to the weight engine, driven by this card's config.
    const declaredValue = Number(shipment.shipmentValue ?? shipment.declaredValue ?? 0);
    const fuel = r2(freight * (Number(card.fuelPct) / 100));
    const fov = r2(declaredValue * (Number(card.fovPct) / 100));
    const isOda = !!shipment.isOda;
    const oda = isOda ? r2(Math.max(Number(card.odaFlat), Number(card.odaMin))) : 0;

    const chargeableKg = r2(boxes.reduce((a: number, p: any) => a + boxKg(p), 0));
    const lines: ChargeBreakup['lines'] = [{ code: 'FREIGHT', head: `Freight (per-box × weight slab: ${pcs} box${pcs > 1 ? 'es' : ''})`, amount: freight }];
    if (fuel > 0) lines.push({ code: 'FUEL', head: `Fuel ${card.fuelPct}%`, amount: fuel });
    if (fov > 0) lines.push({ code: 'FOV', head: `FOV ${card.fovPct}% on ₹${declaredValue}`, amount: fov });
    if (oda > 0) lines.push({ code: 'ODA', head: 'ODA', amount: oda });

    return {
      chargeableKg, freight, fuel, fov, oda, docket: 0, handling: 0,
      subtotal: r2(freight + fuel + fov + oda), lines, basis: `per-box ${pcs} box × weight slab (avg ₹${perBox})`,
    };
  }
}
