import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChargeBreakup } from './rate.service';

const r2 = (n: number) => +n.toFixed(2);

/**
 * ALTERNATIVE freight engine: price by pieces (per-box) using a pcs-count slab, when the
 * customer×product has a PerBoxRateCard. Fully isolated from the weight engine — it produces
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
      include: { slabs: { orderBy: { fromPcs: 'asc' } } },
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
        slabs: { create: (dto.slabs || []).map((s: any) => ({ fromPcs: Number(s.fromPcs) || 0, toPcs: Number(s.toPcs) || 0, perBox: Number(s.perBox) || 0 })) },
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
      include: { slabs: { orderBy: { fromPcs: 'asc' } } },
    });
    if (!cards.length) return null;

    // Prefer a card whose network matches the shipment's vendor, else SELF, else the first.
    const vendor = String(shipment.vendor || 'SELF').toUpperCase();
    const card = cards.find((c) => (c.network || '').toUpperCase() === vendor)
      || cards.find((c) => (c.network || 'SELF').toUpperCase() === 'SELF')
      || cards[0];
    if (!card.slabs.length) return null;

    const pcs = (pieces?.length || Number(shipment.pieceCount) || 1);
    // The slab whose range contains pcs; if the count is beyond the top slab, use the highest.
    const slab = card.slabs.find((s) => pcs >= s.fromPcs && pcs <= s.toPcs)
      || [...card.slabs].sort((a, b) => b.toPcs - a.toPcs)[0];
    const perBox = Number(slab.perBox);
    const freight = r2(pcs * perBox);

    // Accessorials on top — identical formulas to the weight engine, driven by this card's config.
    const declaredValue = Number(shipment.shipmentValue ?? shipment.declaredValue ?? 0);
    const fuel = r2(freight * (Number(card.fuelPct) / 100));
    const fov = r2(declaredValue * (Number(card.fovPct) / 100));
    const isOda = !!shipment.isOda;
    const oda = isOda ? r2(Math.max(Number(card.odaFlat), Number(card.odaMin))) : 0;

    const chargeableKg = r2((pieces || []).reduce((a: number, p: any) => a + (Number(p.deadKg) || 0), 0));
    const lines: ChargeBreakup['lines'] = [{ code: 'FREIGHT', head: `Freight (per-box: ${pcs} × ₹${perBox})`, amount: freight }];
    if (fuel > 0) lines.push({ code: 'FUEL', head: `Fuel ${card.fuelPct}%`, amount: fuel });
    if (fov > 0) lines.push({ code: 'FOV', head: `FOV ${card.fovPct}% on ₹${declaredValue}`, amount: fov });
    if (oda > 0) lines.push({ code: 'ODA', head: 'ODA', amount: oda });

    return {
      chargeableKg, freight, fuel, fov, oda, docket: 0, handling: 0,
      subtotal: r2(freight + fuel + fov + oda), lines, basis: `per-box ${pcs}pc × ₹${perBox}`,
    };
  }
}
