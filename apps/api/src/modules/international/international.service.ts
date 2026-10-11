import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, IntlMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Default volumetric divisors (cm³ per kg). Express couriers use 5000; IATA air freight uses 6000. */
const DIVISOR: Record<string, number> = { EXPRESS: 5000, AIR_FREIGHT: 6000, OCEAN_FCL: 6000, OCEAN_LCL: 6000 };

export interface IntlPkgInput { count?: number; lengthCm?: number; widthCm?: number; heightCm?: number; weightKg?: number; description?: string }
export interface IntlInput {
  mode: IntlMode; direction?: 'EXPORT' | 'IMPORT'; clientId: number; incoterm?: string; serviceLevel?: string;
  shipperName?: string; shipperAddress?: string; shipperCity?: string; shipperCountry?: string; shipperContact?: string;
  consigneeName?: string; consigneeAddress?: string; consigneeCity?: string; consigneeCountry?: string; consigneeContact?: string;
  originCountry?: string; originPort?: string; destCountry?: string; destPort?: string; carrier?: string; forwarderRef?: string;
  houseNo?: string; masterNo?: string; containerNo?: string; containerType?: string; vesselVoyage?: string;
  grossWeightKg?: number; declaredValue?: number; currency?: string; goodsDesc?: string; hsCode?: string; marksNumbers?: string;
  bookedAt?: string; etd?: string; eta?: string; pickupAt?: string; remarks?: string;
  packages?: IntlPkgInput[];
}

@Injectable()
export class InternationalService {
  constructor(private readonly prisma: PrismaService) {}

  /** INTL-YYYY-000001, sequential within the year. */
  private async nextJobNo(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.intlShipment.count({ where: { jobNo: { startsWith: `INTL-${year}-` } } });
    return `INTL-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  /** Volumetric kg + CBM from the package list, using the mode's divisor. */
  private cargoTotals(mode: IntlMode, pkgs: IntlPkgInput[], divisor?: number) {
    const div = divisor && divisor > 0 ? divisor : DIVISOR[mode] ?? 5000;
    let volCm3 = 0, pkgGross = 0, pieces = 0;
    for (const p of pkgs || []) {
      const c = Math.max(1, Math.floor(Number(p.count) || 1));
      pieces += c;
      const L = Number(p.lengthCm) || 0, W = Number(p.widthCm) || 0, H = Number(p.heightCm) || 0;
      volCm3 += c * L * W * H;
      pkgGross += c * (Number(p.weightKg) || 0);
    }
    const volumetricKg = +(volCm3 / div).toFixed(3);
    const volumeCbm = +(volCm3 / 1_000_000).toFixed(4);
    return { volumetricKg, volumeCbm, pkgGross: +pkgGross.toFixed(3), pieces };
  }

  private chargeable(mode: IntlMode, grossKg: number, volumetricKg: number): number {
    if (mode === 'OCEAN_FCL' || mode === 'OCEAN_LCL') return 0; // ocean bills by CBM / container, not chargeable kg
    return +Math.max(grossKg || 0, volumetricKg || 0).toFixed(3);
  }

  async create(input: IntlInput, userId?: number) {
    if (!input.mode) throw new BadRequestException('Mode is required (EXPRESS / AIR_FREIGHT / OCEAN_FCL / OCEAN_LCL).');
    if (!(Number(input.clientId) > 0)) throw new BadRequestException('Customer is required.');
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(input.clientId) }, select: { id: true } });
    if (!client) throw new NotFoundException('Customer not found.');
    const pkgs = input.packages ?? [];
    const t = this.cargoTotals(input.mode, pkgs);
    const grossKg = Number(input.grossWeightKg) || t.pkgGross || 0;
    const jobNo = await this.nextJobNo();
    const d = (v?: string) => (v ? new Date(v) : null);

    const s = await this.prisma.intlShipment.create({
      data: {
        jobNo, mode: input.mode, direction: (input.direction as any) ?? 'EXPORT', status: 'BOOKED',
        clientId: BigInt(input.clientId), incoterm: input.incoterm || null, serviceLevel: input.serviceLevel || null,
        shipperName: input.shipperName || null, shipperAddress: input.shipperAddress || null, shipperCity: input.shipperCity || null, shipperCountry: input.shipperCountry || null, shipperContact: input.shipperContact || null,
        consigneeName: input.consigneeName || null, consigneeAddress: input.consigneeAddress || null, consigneeCity: input.consigneeCity || null, consigneeCountry: input.consigneeCountry || null, consigneeContact: input.consigneeContact || null,
        originCountry: input.originCountry || null, originPort: input.originPort || null, destCountry: input.destCountry || null, destPort: input.destPort || null, carrier: input.carrier || null, forwarderRef: input.forwarderRef || null,
        houseNo: input.houseNo || null, masterNo: input.masterNo || null, containerNo: input.containerNo || null, containerType: input.containerType || null, vesselVoyage: input.vesselVoyage || null,
        packages: t.pieces || 1, grossWeightKg: new Prisma.Decimal(grossKg),
        volumeCbm: new Prisma.Decimal(t.volumeCbm), chargeableWeightKg: new Prisma.Decimal(this.chargeable(input.mode, grossKg, t.volumetricKg)),
        declaredValue: input.declaredValue != null ? new Prisma.Decimal(input.declaredValue) : null, currency: input.currency || 'USD',
        goodsDesc: input.goodsDesc || null, hsCode: input.hsCode || null, marksNumbers: input.marksNumbers || null,
        bookedAt: d(input.bookedAt) ?? new Date(), etd: d(input.etd), eta: d(input.eta), pickupAt: d(input.pickupAt),
        remarks: input.remarks || null, createdById: userId != null ? BigInt(userId) : null,
        pieces: { create: pkgs.map((p) => ({ count: Math.max(1, Math.floor(Number(p.count) || 1)), lengthCm: p.lengthCm != null ? new Prisma.Decimal(p.lengthCm) : null, widthCm: p.widthCm != null ? new Prisma.Decimal(p.widthCm) : null, heightCm: p.heightCm != null ? new Prisma.Decimal(p.heightCm) : null, weightKg: p.weightKg != null ? new Prisma.Decimal(p.weightKg) : null, description: p.description || null })) },
      },
      include: { pieces: true },
    });
    return s;
  }

  async list(params: { mode?: string; status?: string; clientId?: number; q?: string; limit?: number } = {}) {
    const where: any = {};
    if (params.mode) where.mode = params.mode;
    if (params.status) where.status = params.status;
    if (params.clientId != null) where.clientId = BigInt(params.clientId);
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { jobNo: { contains: q, mode: 'insensitive' } }, { houseNo: { contains: q, mode: 'insensitive' } },
        { masterNo: { contains: q, mode: 'insensitive' } }, { consigneeName: { contains: q, mode: 'insensitive' } },
        { containerNo: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.intlShipment.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(params.limit ?? 200, 500) });
    const clients = await this.clientMap(rows.map((r) => r.clientId));
    return rows.map((r) => ({ ...this.view(r), customer: clients.get(r.clientId.toString()) ?? null }));
  }

  async get(idOrJob: string) {
    const s = await this.prisma.intlShipment.findFirst({
      where: /^\d+$/.test(idOrJob) ? { OR: [{ id: BigInt(idOrJob) }, { jobNo: idOrJob }] } : { jobNo: idOrJob },
      include: { pieces: { orderBy: { id: 'asc' } }, charges: { orderBy: { id: 'asc' } } },
    });
    if (!s) throw new NotFoundException(`International job ${idOrJob} not found`);
    const client = await this.prisma.b2bClient.findUnique({ where: { id: s.clientId }, select: { legalName: true, accountCode: true, gstin: true, addressLine: true, city: true, state: true, iecCode: true, contactEmail: true } });
    return { ...this.view(s), client, pieces: s.pieces.map((p) => this.pkgView(p)), charges: s.charges.map((c) => this.chargeView(c)) };
  }

  async update(id: number, input: Partial<IntlInput>) {
    const s = await this.prisma.intlShipment.findUnique({ where: { id: BigInt(id) }, include: { pieces: true } });
    if (!s) throw new NotFoundException('Job not found');
    const data: any = {};
    const set = (k: keyof IntlInput, col = k as string) => { if ((input as any)[k] !== undefined) data[col] = (input as any)[k] || null; };
    for (const k of ['incoterm', 'serviceLevel', 'shipperName', 'shipperAddress', 'shipperCity', 'shipperCountry', 'shipperContact', 'consigneeName', 'consigneeAddress', 'consigneeCity', 'consigneeCountry', 'consigneeContact', 'originCountry', 'originPort', 'destCountry', 'destPort', 'carrier', 'forwarderRef', 'houseNo', 'masterNo', 'containerNo', 'containerType', 'vesselVoyage', 'goodsDesc', 'hsCode', 'marksNumbers', 'currency', 'remarks'] as (keyof IntlInput)[]) set(k);
    if (input.direction !== undefined) data.direction = input.direction;
    for (const k of ['bookedAt', 'etd', 'eta', 'pickupAt'] as const) if ((input as any)[k] !== undefined) data[k] = (input as any)[k] ? new Date((input as any)[k]) : null;
    if (input.declaredValue !== undefined) data.declaredValue = input.declaredValue != null ? new Prisma.Decimal(input.declaredValue) : null;
    // Re-costing when packages or gross weight change.
    if (input.packages !== undefined) {
      const pkgs = input.packages ?? [];
      const t = this.cargoTotals(s.mode, pkgs);
      const grossKg = Number(input.grossWeightKg ?? s.grossWeightKg) || t.pkgGross || 0;
      data.packages = t.pieces || 1;
      data.grossWeightKg = new Prisma.Decimal(grossKg);
      data.volumeCbm = new Prisma.Decimal(t.volumeCbm);
      data.chargeableWeightKg = new Prisma.Decimal(this.chargeable(s.mode, grossKg, t.volumetricKg));
      await this.prisma.intlPackage.deleteMany({ where: { shipmentId: s.id } });
      data.pieces = { create: pkgs.map((p) => ({ count: Math.max(1, Math.floor(Number(p.count) || 1)), lengthCm: p.lengthCm != null ? new Prisma.Decimal(p.lengthCm) : null, widthCm: p.widthCm != null ? new Prisma.Decimal(p.widthCm) : null, heightCm: p.heightCm != null ? new Prisma.Decimal(p.heightCm) : null, weightKg: p.weightKg != null ? new Prisma.Decimal(p.weightKg) : null, description: p.description || null })) };
    } else if (input.grossWeightKg !== undefined) {
      const grossKg = Number(input.grossWeightKg) || 0;
      const volKg = Number(s.chargeableWeightKg) >= grossKg ? Number(s.chargeableWeightKg) : grossKg; // keep existing vol basis
      data.grossWeightKg = new Prisma.Decimal(grossKg);
      data.chargeableWeightKg = new Prisma.Decimal(this.chargeable(s.mode, grossKg, volKg));
    }
    const updated = await this.prisma.intlShipment.update({ where: { id: s.id }, data, include: { pieces: true } });
    return this.view(updated);
  }

  async setStatus(id: number, status: string) {
    const valid = ['DRAFT', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'ARRIVED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
    if (!valid.includes(status)) throw new BadRequestException(`Invalid status. One of: ${valid.join(', ')}`);
    const s = await this.prisma.intlShipment.update({ where: { id: BigInt(id) }, data: { status: status as any } });
    return this.view(s);
  }

  async cancel(id: number) { return this.setStatus(id, 'CANCELLED'); }

  // ---- charges ----
  async addCharge(shipmentId: number, dto: { code?: string; name: string; amount: number; currency?: string; taxable?: boolean }) {
    const s = await this.prisma.intlShipment.findUnique({ where: { id: BigInt(shipmentId) }, select: { id: true, currency: true } });
    if (!s) throw new NotFoundException('Job not found');
    if (!(Number(dto.amount) !== 0)) throw new BadRequestException('Amount is required.');
    const c = await this.prisma.intlCharge.create({ data: { shipmentId: s.id, code: (dto.code || 'MISC').toUpperCase(), name: dto.name || dto.code || 'Charge', amount: new Prisma.Decimal(dto.amount), currency: dto.currency || s.currency || 'USD', taxable: !!dto.taxable } });
    return this.chargeView(c);
  }
  async deleteCharge(chargeId: number) { await this.prisma.intlCharge.delete({ where: { id: BigInt(chargeId) } }); return { ok: true }; }
  async listCharges(shipmentId: number) { const cs = await this.prisma.intlCharge.findMany({ where: { shipmentId: BigInt(shipmentId) }, orderBy: { id: 'asc' } }); return cs.map((c) => this.chargeView(c)); }

  // ---- rating ----
  /** Quote freight for a prospective or booked shipment. Picks the best-matching rate card
   *  (client-specific first, then the base/default) for the mode + lane. */
  async quote(dto: { mode: IntlMode; clientId?: number; originCountry?: string; destCountry?: string; grossWeightKg?: number; volumeCbm?: number; chargeableWeightKg?: number; containers?: number; packages?: IntlPkgInput[] }) {
    if (!dto.mode) throw new BadRequestException('Mode is required.');
    const cards = await this.prisma.intlRateCard.findMany({ where: { mode: dto.mode, active: true, OR: [{ clientId: dto.clientId != null ? BigInt(dto.clientId) : undefined }, { clientId: null }] }, orderBy: [{ clientId: 'desc' }] });
    const scopeHit = (scope: string | null, country?: string) => !scope || !country || scope.toUpperCase() === String(country).toUpperCase();
    const card = cards.find((c) => scopeHit(c.originScope, dto.originCountry) && scopeHit(c.destScope, dto.destCountry)) || cards[0] || null;
    const t = this.cargoTotals(dto.mode, dto.packages ?? [], card?.volumetricDivisor ?? undefined);
    const gross = Number(dto.grossWeightKg) || t.pkgGross || 0;
    const cbm = dto.volumeCbm != null ? Number(dto.volumeCbm) : t.volumeCbm;
    const chargeable = dto.chargeableWeightKg != null ? Number(dto.chargeableWeightKg) : this.chargeable(dto.mode, gross, t.volumetricKg);
    if (!card) return { quoted: false, reason: `No active ${dto.mode} rate card${dto.clientId ? ' for this customer or base' : ''}.`, chargeableWeightKg: chargeable, volumeCbm: cbm };
    const perKg = Number(card.perKg) || 0, perCbm = Number(card.perCbm) || 0, perContainer = Number(card.perContainer) || 0, min = Number(card.minCharge) || 0, fuelPct = Number(card.fuelPct) || 0;
    let base = 0, basis = '';
    if (dto.mode === 'EXPRESS' || dto.mode === 'AIR_FREIGHT') { base = Math.max(min, chargeable * perKg); basis = `${chargeable} kg × ${perKg}/kg`; }
    else if (dto.mode === 'OCEAN_LCL') { const revTon = Math.max(gross / 1000, cbm); base = Math.max(min, revTon * perCbm); basis = `${revTon.toFixed(3)} R/T (W/M) × ${perCbm}/CBM`; }
    else { const n = Math.max(1, Math.floor(Number(dto.containers) || 1)); base = perContainer * n; basis = `${n} × ${perContainer}/container`; }
    const fuel = +(base * fuelPct / 100).toFixed(2);
    const total = +(base + fuel).toFixed(2);
    return { quoted: true, rateCard: card.name, currency: card.currency, chargeableWeightKg: chargeable, volumeCbm: cbm, basis, base: +base.toFixed(2), fuelPct, fuel, total };
  }

  async listCards(filter: { mode?: string; clientId?: number } = {}) {
    const where: any = {};
    if (filter.mode) where.mode = filter.mode;
    if (filter.clientId !== undefined) where.clientId = filter.clientId != null ? BigInt(filter.clientId) : null;
    const rows = await this.prisma.intlRateCard.findMany({ where, orderBy: [{ mode: 'asc' }, { name: 'asc' }] });
    return rows.map((c) => this.cardView(c));
  }
  async upsertCard(dto: any) {
    const data = {
      name: String(dto.name || '').trim() || 'Rate', mode: dto.mode, clientId: dto.clientId != null && dto.clientId !== '' ? BigInt(dto.clientId) : null,
      originScope: dto.originScope || null, destScope: dto.destScope || null,
      perKg: dto.perKg != null && dto.perKg !== '' ? new Prisma.Decimal(dto.perKg) : null,
      perCbm: dto.perCbm != null && dto.perCbm !== '' ? new Prisma.Decimal(dto.perCbm) : null,
      perContainer: dto.perContainer != null && dto.perContainer !== '' ? new Prisma.Decimal(dto.perContainer) : null,
      minCharge: dto.minCharge != null && dto.minCharge !== '' ? new Prisma.Decimal(dto.minCharge) : null,
      fuelPct: dto.fuelPct != null && dto.fuelPct !== '' ? new Prisma.Decimal(dto.fuelPct) : null,
      volumetricDivisor: dto.volumetricDivisor != null && dto.volumetricDivisor !== '' ? Math.floor(Number(dto.volumetricDivisor)) : null,
      currency: dto.currency || 'USD', active: dto.active !== false,
    };
    if (!data.mode) throw new BadRequestException('Mode is required for a rate card.');
    const c = dto.id ? await this.prisma.intlRateCard.update({ where: { id: BigInt(dto.id) }, data }) : await this.prisma.intlRateCard.create({ data });
    return this.cardView(c);
  }
  async deleteCard(id: number) { await this.prisma.intlRateCard.delete({ where: { id: BigInt(id) } }); return { ok: true }; }

  /** Data for the commercial invoice / packing list document. */
  async docData(idOrJob: string) {
    const s = await this.get(idOrJob);
    const itemsTotal = (s.charges || []).reduce((n: number, c: any) => n + Number(c.amount), 0);
    return { ...s, chargesTotal: +itemsTotal.toFixed(2) };
  }

  // ---- views (BigInt → string, Decimal → number) ----
  private async clientMap(ids: bigint[]) {
    const uniq = [...new Set(ids.map((i) => i.toString()))].map((i) => BigInt(i));
    const cs = uniq.length ? await this.prisma.b2bClient.findMany({ where: { id: { in: uniq } }, select: { id: true, legalName: true, accountCode: true } }) : [];
    return new Map(cs.map((c) => [c.id.toString(), { legalName: c.legalName, accountCode: c.accountCode }]));
  }
  private num(v: any) { return v == null ? null : Number(v); }
  private view(s: any) {
    return {
      id: s.id.toString(), jobNo: s.jobNo, mode: s.mode, direction: s.direction, status: s.status, clientId: s.clientId.toString(),
      incoterm: s.incoterm, serviceLevel: s.serviceLevel,
      shipperName: s.shipperName, shipperAddress: s.shipperAddress, shipperCity: s.shipperCity, shipperCountry: s.shipperCountry, shipperContact: s.shipperContact,
      consigneeName: s.consigneeName, consigneeAddress: s.consigneeAddress, consigneeCity: s.consigneeCity, consigneeCountry: s.consigneeCountry, consigneeContact: s.consigneeContact,
      originCountry: s.originCountry, originPort: s.originPort, destCountry: s.destCountry, destPort: s.destPort, carrier: s.carrier, forwarderRef: s.forwarderRef,
      houseNo: s.houseNo, masterNo: s.masterNo, containerNo: s.containerNo, containerType: s.containerType, vesselVoyage: s.vesselVoyage,
      packages: s.packages, grossWeightKg: this.num(s.grossWeightKg), volumeCbm: this.num(s.volumeCbm), chargeableWeightKg: this.num(s.chargeableWeightKg),
      declaredValue: this.num(s.declaredValue), currency: s.currency, goodsDesc: s.goodsDesc, hsCode: s.hsCode, marksNumbers: s.marksNumbers,
      bookedAt: s.bookedAt, etd: s.etd, eta: s.eta, pickupAt: s.pickupAt, remarks: s.remarks, createdAt: s.createdAt,
    };
  }
  private pkgView(p: any) { return { id: p.id.toString(), count: p.count, lengthCm: this.num(p.lengthCm), widthCm: this.num(p.widthCm), heightCm: this.num(p.heightCm), weightKg: this.num(p.weightKg), description: p.description }; }
  private chargeView(c: any) { return { id: c.id.toString(), code: c.code, name: c.name, amount: this.num(c.amount), currency: c.currency, taxable: c.taxable }; }
  private cardView(c: any) { return { id: c.id.toString(), name: c.name, mode: c.mode, clientId: c.clientId ? c.clientId.toString() : null, originScope: c.originScope, destScope: c.destScope, perKg: this.num(c.perKg), perCbm: this.num(c.perCbm), perContainer: this.num(c.perContainer), minCharge: this.num(c.minCharge), fuelPct: this.num(c.fuelPct), volumetricDivisor: c.volumetricDivisor, currency: c.currency, active: c.active }; }
}
