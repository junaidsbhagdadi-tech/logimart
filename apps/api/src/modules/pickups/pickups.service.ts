import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PickupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BluedartService } from '../bluedart/bluedart.service';
import { ShipmentsService } from '../shipments/shipments.service';

interface CreatePickup {
  clientId: number;
  pickupAddress: string;
  city?: string;
  pincode?: string;
  contactName?: string;
  contactPhone?: string;
  estPieces?: number;
  cargoMode?: string;
  product?: string;
  weight?: number;
  vendor?: string;
  isWarehouse?: boolean;
  refNo?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  invoiceValue?: number;
  ewbNo?: string;
  notes?: string;
}

@Injectable()
export class PickupsService {
  constructor(private readonly prisma: PrismaService, private readonly bluedart: BluedartService, private readonly shipments: ShipmentsService) {}

  create(dto: CreatePickup) {
    return this.prisma.pickupRequest.create({
      data: {
        clientId: BigInt(dto.clientId),
        pickupAddress: dto.pickupAddress,
        city: dto.city,
        pincode: dto.pincode,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        estPieces: dto.estPieces ?? 1,
        cargoMode: dto.cargoMode,
        product: dto.product || null,
        weight: dto.weight != null ? new Prisma.Decimal(dto.weight) : null,
        vendor: dto.vendor || null,
        isWarehouse: !!dto.isWarehouse,
        refNo: dto.refNo || null,
        invoiceNo: dto.invoiceNo,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
        invoiceValue: dto.invoiceValue != null ? new Prisma.Decimal(dto.invoiceValue) : null,
        ewbNo: dto.ewbNo,
        notes: dto.notes,
      },
    });
  }

  /** Bulk pickup-request upload. Each row resolves its client by accountCode or internal id (or the
   *  forced clientId for a portal login). Bad rows are reported, good rows imported — the rest continue. */
  async bulkCreate(rows: any[], forcedClientId?: number, vendor?: string) {
    const results: { row: string; ok: boolean; error?: string }[] = [];
    for (const r of rows || []) {
      const label = String(r.pickupAddress ?? r.accountCode ?? r.clientId ?? '(blank)').slice(0, 40);
      try {
        let clientId = forcedClientId;
        if (!clientId) {
          const code = String(r.clientId ?? r.accountCode ?? '').trim();
          if (!code) { results.push({ row: label, ok: false, error: 'clientId / accountCode required' }); continue; }
          const c = await this.prisma.b2bClient.findFirst({
            where: /^\d+$/.test(code) ? { OR: [{ id: BigInt(code) }, { accountCode: { equals: code, mode: 'insensitive' } }] } : { accountCode: { equals: code, mode: 'insensitive' } },
            select: { id: true },
          });
          if (!c) { results.push({ row: label, ok: false, error: `Client "${code}" not found` }); continue; }
          clientId = Number(c.id);
        }
        if (!r.pickupAddress || String(r.pickupAddress).trim().length < 4) { results.push({ row: label, ok: false, error: 'pickupAddress required (min 4 chars)' }); continue; }
        await this.create({
          clientId, pickupAddress: String(r.pickupAddress).trim(), city: r.city, pincode: r.pincode,
          contactName: r.contactName, contactPhone: r.contactPhone,
          estPieces: r.estPieces != null && r.estPieces !== '' ? Number(r.estPieces) : 1,
          // a per-row vendor wins; otherwise the single vendor chosen for the whole upload (blank = none)
          cargoMode: r.cargoMode, vendor: (r.vendor && String(r.vendor).trim()) || vendor || undefined,
          invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate,
          invoiceValue: r.invoiceValue != null && r.invoiceValue !== '' ? Number(r.invoiceValue) : undefined,
          ewbNo: r.ewbNo, notes: r.notes,
        });
        results.push({ row: label, ok: true });
      } catch (e) { results.push({ row: label, ok: false, error: (e as Error).message }); }
    }
    return { total: (rows || []).length, created: results.filter((r) => r.ok).length, results };
  }

  /** Client admins see only their own requests; ops staff see all. Each row carries the requesting
   *  customer's code + name (for the CS list). */
  async list(clientId?: bigint, scope?: bigint[] | null) {
    const rows = await this.prisma.pickupRequest.findMany({
      where: clientId != null ? { clientId } : scope ? { clientId: { in: scope } } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    const ids = [...new Set(rows.map((r) => r.clientId))];
    const clients = ids.length ? await this.prisma.b2bClient.findMany({ where: { id: { in: ids } }, select: { id: true, accountCode: true, legalName: true } }) : [];
    const byId = new Map(clients.map((c) => [String(c.id), c]));
    return rows.map((r) => ({ ...r, customerCode: byId.get(String(r.clientId))?.accountCode ?? null, customerName: byId.get(String(r.clientId))?.legalName ?? null }));
  }

  async assign(id: number, riderId: number) {
    await this.exists(id);
    return this.prisma.pickupRequest.update({
      where: { id: BigInt(id) },
      data: { assignedRiderId: BigInt(riderId), status: PickupStatus.ASSIGNED },
    });
  }

  /**
   * Mark a pickup PICKED with the actuals. When an AWB is given it becomes billable for the customer:
   * an AWB already booked (ours or a carrier no) is linked; otherwise, with a destination pincode, the
   * shipment is BOOKED now under the pickup's customer (product/vendor/pickup address from the request)
   * and moved to Picked — so it lands on the customer's bill. Without a destination it's recorded only.
   */
  async complete(id: number, captured: { awb?: string; weight?: number; pieces?: number; value?: number; destPincode?: string; consigneeName?: string; consigneePhone?: string; consigneeAddress?: string } = {}) {
    const p = await this.exists(id);
    let shipment: { awb: string; booked: boolean } | null = null;
    const awb = String(captured.awb ?? '').trim().toUpperCase();
    if (awb) {
      const existing = await this.prisma.shipment.findFirst({ where: { OR: [{ awb }, { forwardingAwb: { equals: awb, mode: 'insensitive' } }] }, select: { awb: true, clientId: true } });
      if (existing) {
        if (String(existing.clientId) !== String(p.clientId)) throw new BadRequestException(`AWB ${awb} is already booked under another customer — check the number.`);
        shipment = { awb: existing.awb, booked: false };
      } else if (captured.destPincode && String(captured.destPincode).trim()) {
        const pcs = Math.max(1, Math.floor(Number(captured.pieces ?? p.estPieces ?? 1)));
        const kg = Number(captured.weight ?? p.weight ?? 0) || 0.5;
        const product = String(p.product || 'SFC').toUpperCase();
        const surface = /SFC|SURFACE|ROAD|RAIL|TOSFC|HUB/.test(product) || /ROAD|SURFACE/i.test(String(p.cargoMode ?? ''));
        const client = await this.prisma.b2bClient.findUnique({ where: { id: p.clientId }, select: { legalName: true } });
        const value = captured.value ?? (p.invoiceValue != null ? Number(p.invoiceValue) : undefined);
        const created: any = await this.shipments.create({
          clientId: Number(p.clientId), manualAwb: awb, product, serviceMode: surface ? 'ROAD_PTL' : 'AIR_EXPRESS',
          originZone: '', destZone: '', originPincode: p.pincode ?? undefined, destPincode: String(captured.destPincode).trim(),
          shipperName: p.contactName || client?.legalName || undefined, shipperAddress1: p.pickupAddress, shipperCity: p.city ?? undefined,
          shipperPincode: p.pincode ?? undefined, shipperMobile: p.contactPhone ?? undefined,
          consigneeName: captured.consigneeName || undefined, consigneePhone: captured.consigneePhone || undefined, consigneeAddress: captured.consigneeAddress || undefined,
          vendor: p.vendor || undefined, referenceNo: p.refNo || undefined, ewbNo: p.ewbNo || undefined, invoiceNo: p.invoiceNo || undefined,
          declaredValue: value, shipmentValue: value,
          pieces: Array.from({ length: pcs }, () => ({ deadKg: +(kg / pcs).toFixed(3) })),
        } as any, { skipAutoDispatch: true });
        // It's physically collected → Picked, and carry the carrier pickup token so tracking finds the waybill.
        await this.prisma.shipment.update({ where: { awb: created.awb }, data: { statusCode: 'PKD', status: 'PICKED_UP' as any, statusAt: new Date(), ...(p.token ? { bdPickupToken: p.token, bdPickupAt: p.handoffAt ?? new Date() } : {}) } });
        await this.prisma.scanLog.create({ data: { awb: created.awb, eventType: 'PKD', remark: `Picked — pickup request #${id}` } });
        shipment = { awb: created.awb, booked: true };
      }
    }
    const updated = await this.prisma.pickupRequest.update({
      where: { id: BigInt(id) },
      data: {
        status: PickupStatus.PICKED,
        ...(captured.awb ? { pickedAwb: String(captured.awb).trim() } : {}),
        ...(captured.weight != null ? { pickedWeight: new Prisma.Decimal(captured.weight) } : {}),
        ...(captured.pieces != null ? { pickedPieces: Math.max(1, Math.floor(captured.pieces)) } : {}),
        ...(captured.value != null ? { pickedValue: new Prisma.Decimal(captured.value) } : {}),
      },
    });
    return { ...updated, shipment };
  }

  /** Full detail for one pickup request (+ the customer), for the CS detail popup. */
  async detail(id: number) {
    const p = await this.prisma.pickupRequest.findUnique({ where: { id: BigInt(id) } });
    if (!p) throw new NotFoundException('Pickup request not found');
    const client = await this.prisma.b2bClient.findUnique({ where: { id: p.clientId }, select: { legalName: true, accountCode: true, contactPhone: true } });
    const rider = p.assignedRiderId ? await this.prisma.user.findUnique({ where: { id: p.assignedRiderId }, select: { fullName: true, riderCode: true } }) : null;
    return { ...p, client, rider };
  }

  /** CS hands a customer's pickup request off to BlueDart → registers the carrier pickup, stores the
   *  returned token on the request (reflects on the customer's panel), and marks it assigned. */
  async handoff(id: number, opts: { vendor?: string; toPay?: boolean; date?: string; token?: string } = {}) {
    const p = await this.exists(id);
    if (p.token) throw new BadRequestException(`This pickup is already handed off (token ${p.token}).`);
    // CS picks the carrier (can override the customer's choice). BlueDart registers via API and returns a
    // token; any other vendor is recorded (with an optional manually-entered token) — no API for them yet.
    const vendor = (opts.vendor || p.vendor || '').trim();
    // BlueDart = the generic BDR code OR a per-account BlueDart vendor (476954 LOGM, 439154 XLX, …) —
    // those previously failed the /^BLUE|BDR/ test and were only *recorded*, never sent to BlueDart.
    if (await this.bluedart.isBlueDartVendor(vendor || p.vendor)) {
      const res = await this.bluedart.scheduleAdhocPickup({
        vendor: vendor || p.vendor || null, bdAccountId: (p as any).bdAccountId ?? null,
        pincode: String(p.pincode ?? ''), name: p.contactName ?? '', phone: p.contactPhone ?? '',
        address1: p.pickupAddress, city: p.city ?? undefined,
        pieces: p.estPieces ?? 1, weight: p.weight != null ? Number(p.weight) : undefined,
        // To-pay if CS ticked it, or the requested product is a to-pay / reverse product.
        toPay: opts.toPay || ['FOD', 'TOSFC', 'TAPEX', 'TODP'].includes(String(p.product ?? '').toUpperCase()),
        date: opts.date, remarks: `Portal pickup #${id}`,
      });
      const updated = await this.prisma.pickupRequest.update({
        where: { id: BigInt(id) }, data: { token: res.token, handoffAt: new Date(), vendor: vendor || 'BDR', status: PickupStatus.ASSIGNED },
      });
      return { ...updated, token: res.token, toPay: res.toPay, outstation: res.outstation };
    }
    if (!vendor) throw new BadRequestException('Pick a vendor to hand this pickup off to.');
    const updated = await this.prisma.pickupRequest.update({
      where: { id: BigInt(id) }, data: { token: opts.token?.trim() || null, handoffAt: new Date(), vendor, status: PickupStatus.ASSIGNED },
    });
    return { ...updated, token: updated.token, manual: true };
  }

  private async exists(id: number) {
    const p = await this.prisma.pickupRequest.findUnique({ where: { id: BigInt(id) } });
    if (!p) throw new NotFoundException('Pickup request not found');
    return p;
  }

  /** Unified pickups across all carriers — internal pickup requests (any vendor / rider) merged with
   *  carrier-registered pickups (BlueDart). Powers the mobile Pickups app. Normalised + filterable. */
  async unified(params: { status?: string; carrier?: string; window?: 'today' | 'upcoming' | 'all'; clientId?: number; scope?: bigint[] | null } = {}) {
    const cf = params.clientId != null ? BigInt(params.clientId) : undefined;
    // Customer login → its account; #10 branch/company-scoped staff → their customers.
    const cw: any = cf != null ? { clientId: cf } : params.scope ? { clientId: { in: params.scope } } : {};
    const [reqs, bds] = await Promise.all([
      this.prisma.pickupRequest.findMany({ where: cw, orderBy: { createdAt: 'desc' }, take: 400 }),
      this.prisma.shipment.findMany({
        where: { bdPickupToken: { not: null }, ...cw },
        orderBy: { bdPickupAt: 'desc' }, take: 400,
        select: { awb: true, clientId: true, bdPickupToken: true, bdPickupAt: true, bdWaybill: true, bdStatus: true, statusCode: true, shipperName: true, shipperAddress1: true, shipperCity: true, shipperPincode: true, shipperContact: true, pieceCount: true },
      }),
    ]);
    const clientIds = [...new Set([...reqs.map((r) => r.clientId.toString()), ...bds.map((b) => b.clientId.toString())])].map((i) => BigInt(i));
    const riderIds = [...new Set(reqs.map((r) => r.assignedRiderId).filter((x): x is bigint => !!x).map((x) => x.toString()))].map((i) => BigInt(i));
    const [clients, riders] = await Promise.all([
      clientIds.length ? this.prisma.b2bClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, legalName: true, accountCode: true } }) : [],
      riderIds.length ? this.prisma.user.findMany({ where: { id: { in: riderIds } }, select: { id: true, fullName: true, riderCode: true } }) : [],
    ]);
    const cn = new Map<string, any>(clients.map((c) => [c.id.toString(), c] as [string, any]));
    const rn = new Map<string, any>(riders.map((r) => [r.id.toString(), r] as [string, any]));
    const reqStatus = (s: string) => (s === 'REQUESTED' ? 'PENDING' : s === 'ASSIGNED' ? 'SCHEDULED' : s === 'PICKED' ? 'PICKED' : s === 'CANCELLED' ? 'CANCELLED' : s);
    const items: any[] = [
      ...reqs.map((r) => ({
        id: 'req-' + r.id, source: 'REQUEST', requestId: r.id.toString(),
        carrier: r.assignedRiderId ? 'Rider' : (r.vendor || '—'), ref: null, awb: null,
        customer: cn.get(r.clientId.toString())?.legalName ?? null, address: r.pickupAddress, city: r.city, pincode: r.pincode,
        pieces: r.estPieces, contact: r.contactPhone, scheduledAt: r.createdAt, status: reqStatus(String(r.status)),
        rider: r.assignedRiderId ? (rn.get(r.assignedRiderId.toString())?.riderCode ?? `#${r.assignedRiderId}`) : null,
      })),
      ...bds.map((b) => ({
        id: 'bd-' + b.awb, source: 'CARRIER', requestId: null,
        carrier: 'BlueDart', ref: b.bdPickupToken, awb: b.awb,
        customer: cn.get(b.clientId.toString())?.legalName ?? null, address: b.shipperAddress1, city: b.shipperCity, pincode: b.shipperPincode,
        pieces: b.pieceCount, contact: b.shipperContact, scheduledAt: b.bdPickupAt,
        status: String(b.statusCode) === 'CAN' ? 'CANCELLED' : (b.bdWaybill ? 'PICKED' : 'SCHEDULED'), bdStatus: b.bdStatus, rider: null,
      })),
    ];
    let out = items;
    if (params.carrier) out = out.filter((i) => String(i.carrier).toUpperCase().includes(params.carrier!.toUpperCase()));
    if (params.status) out = out.filter((i) => i.status === params.status);
    if (params.window && params.window !== 'all') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today.getTime() + 864e5);
      out = out.filter((i) => { if (!i.scheduledAt) return false; const d = new Date(i.scheduledAt); return params.window === 'today' ? d >= today && d < tomorrow : d >= today; });
    }
    out.sort((a, b) => new Date(b.scheduledAt || 0).getTime() - new Date(a.scheduledAt || 0).getTime());
    return out.slice(0, 500);
  }
}
