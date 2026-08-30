import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, ShipmentStatus, PieceStatus, ScanCheckpoint } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COMPANY, VOLUMETRIC_DIVISOR } from '../../config/company';
import { regionFromPincode } from '../../common/regions';
import { RateService } from '../billing/rate.service';
import { NotesService } from '../notes/notes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RateService,
    private readonly notes: NotesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Volumetric weight in kg from cm dimensions (divisor 5000). */
  private volKg(l?: number, w?: number, h?: number): number {
    if (!l || !w || !h) return 0;
    return Number(((l * w * h) / VOLUMETRIC_DIVISOR).toFixed(3));
  }

  /**
   * Product-specific zone from the pincode master. Only DP-family uses the courier A/B/C grid and only
   * ECOM uses the e-com grid; every OTHER product (Apex + all other air/express products) shares the air
   * (apex) grid. Falls back to broad region → region-from-pincode → the supplied fallback zone.
   */
  private productZone(pin: any, product?: string, serviceMode?: string, pincode?: string, fallback?: string): string | undefined {
    const fam = String(product ?? '').toUpperCase();
    const isCourier = ['DP', 'TDD', 'NDD'].includes(fam);
    const isEcom = ['ECOM', 'ECOMM', 'ECOMMERCE'].includes(fam);
    const isSurface = ['SURFACE', 'SFC', 'HUB'].includes(fam) || /ROAD|RAIL|SURFACE/i.test(String(serviceMode ?? ''));
    const zRaw = pin && (
      isCourier ? pin.dpZone
      : isSurface ? pin.surfaceZone
      : isEcom ? (pin.ecomZone || pin.apexZone)
      : (pin.apexZone || pin.ecomZone)
    );
    const z = zRaw ? String(zRaw).replace(/\s+/g, '').toUpperCase() : zRaw; // "NE 1" -> "NE1"
    return z || pin?.region || (pincode ? regionFromPincode(pincode) : undefined) || fallback;
  }

  /**
   * Promised delivery date = today + transit TAT for the origin→dest zone. TAT is vendor-specific
   * (ZONE_TAT master, code `<VENDOR>__<MODE>`), resolved vendor → SELF → legacy `<MODE>`.
   * SURFACE matrix for surface products, else APEX. Null if no TAT covers the zone pair.
   */
  private async expectedDeliveryFor(product: string | undefined, serviceMode: string, originZone?: string, destZone?: string, vendor?: string): Promise<Date | null> {
    if (!originZone || !destZone) return null;
    const surface = /SURFACE|ROAD|RAIL/i.test(String(serviceMode)) || ['SURFACE', 'HUB'].includes(String(product ?? '').toUpperCase());
    const mode = surface ? 'SURFACE' : 'APEX';
    const net = String(vendor ?? '').trim().toUpperCase() || 'SELF';
    const orig = String(originZone).toUpperCase(), dest = String(destZone).toUpperCase();
    const addDays = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
    for (const code of [`${net}__${mode}`, `SELF__${mode}`, mode]) {
      const entry = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'ZONE_TAT', code } } });
      const days = Number((entry?.attrs as any)?.matrix?.[orig]?.[dest]);
      if (days > 0) return addDays(days);
    }
    // Fallback so an EDD always shows even before the ZONE_TAT matrix is fully configured:
    // same zone → 1 (air) / 2 (surface); otherwise 2 (air) / 4 (surface).
    const sameZone = orig === dest;
    return addDays(surface ? (sameZone ? 2 : 4) : (sameZone ? 1 : 2));
  }

  /**
   * Xpresion-style AWB: prefix + a continuous 10-digit running number (no year),
   * e.g. L1000000045. Uses an atomic row-locked counter so concurrent bookings never
   * collide (the previous count()-based scheme could hand two bookings the same number).
   * Seeded above any existing count-based AWB on first use.
   */
  private async nextAwb(): Promise<string> {
    const c = await this.prisma.counter.upsert({
      where: { name: 'awb' },
      create: { name: 'awb', value: BigInt(1000000100) },
      update: { value: { increment: BigInt(1) } },
    });
    return `${COMPANY.awbPrefix}${c.value}`;
  }

  /**
   * Create a master AWB and atomically generate one child piece per box.
   * Each child gets: childId (AWB-00N), sequenceNo, barcode payload, volKg.
   */
  /** Set of account ids a client login may book under: its group — the parent (head office)
   *  plus all child accounts, via the explicit parentAccountId link. */
  async bookableAccountIds(tokenClientId: number | string): Promise<Set<string>> {
    const own = BigInt(tokenClientId);
    const self = await this.prisma.b2bClient.findUnique({ where: { id: own }, select: { id: true, parentAccountId: true } });
    if (!self) return new Set([String(own)]);
    const rootId = self.parentAccountId ?? self.id;
    const rows = await this.prisma.b2bClient.findMany({ where: { OR: [{ id: rootId }, { parentAccountId: rootId }] }, select: { id: true } });
    return new Set(rows.map((r) => String(r.id)));
  }

  /** Validate a client's requested booking account, falling back to the login's own account. */
  async clientBookingAccount(tokenClientId: number | string, requested?: number | string): Promise<number> {
    const allowed = await this.bookableAccountIds(tokenClientId);
    return requested != null && allowed.has(String(requested)) ? Number(requested) : Number(tokenClientId);
  }

  async create(dto: CreateShipmentDto) {
    // Resolve the customer by internal id OR account code — bulk imports usually carry the account code.
    const cid = String((dto as any).clientId ?? '').trim();
    const sel = { id: true, isActive: true, isCreditHold: true, legalName: true, outstandingBal: true, creditLimit: true };
    let client = /^\d+$/.test(cid) ? await this.prisma.b2bClient.findUnique({ where: { id: BigInt(cid) }, select: sel }) : null;
    if (!client && cid) client = await this.prisma.b2bClient.findFirst({ where: { accountCode: cid }, select: sel });
    if (!client) throw new NotFoundException(`Client not found (id / account code "${cid}") — add the customer (with that account code) first.`);
    (dto as any).clientId = Number(client.id); // downstream uses the internal id
    // ---- Credit control gate: block booking for inactive / over-limit accounts ----
    if (client.isActive === false) {
      throw new ForbiddenException(`${client.legalName} is deactivated — cannot book new shipments.`);
    }
    if (client.isCreditHold && !dto.overrideCreditHold) {
      throw new ForbiddenException(
        `${client.legalName} is on CREDIT HOLD (outstanding ₹${client.outstandingBal} / limit ₹${client.creditLimit}). Clear dues or override to proceed.`,
      );
    }

    // Manually-booked shipments carry a pre-assigned AWB; otherwise auto-generate.
    const manualAwb = (dto as any).manualAwb ? String((dto as any).manualAwb).trim().toUpperCase() : '';
    if (manualAwb) {
      const exists = await this.prisma.shipment.findUnique({ where: { awb: manualAwb }, select: { id: true } });
      if (exists) throw new ConflictException(`AWB ${manualAwb} already exists.`);
    }
    // Dedupe on the forwarding/carrier no too — so a re-uploaded row is caught even when our AWB differs.
    const fwd = (dto as any).forwardingAwb ? String((dto as any).forwardingAwb).trim().toUpperCase() : '';
    if (fwd) {
      const dup = await this.prisma.shipment.findFirst({ where: { forwardingAwb: { equals: fwd, mode: 'insensitive' } }, select: { awb: true } });
      if (dup) throw new ConflictException(`Forwarding no ${fwd} already exists (on AWB ${dup.awb}).`);
    }
    const awb = manualAwb || (await this.nextAwb());
    const total = dto.pieces.length;

    // Product-specific zone from the pincode master (DP→dpZone, APEX→apexZone,
    // SURFACE→surfaceZone), falling back to broad region then the supplied zone.
    const [originPin, destPin] = await Promise.all([
      dto.originPincode ? this.prisma.pincode.findUnique({ where: { pincode: dto.originPincode } }) : null,
      dto.destPincode ? this.prisma.pincode.findUnique({ where: { pincode: dto.destPincode } }) : null,
    ]);
    // Hard-block: a supplied destination pincode must exist in the pincode master.
    if (dto.destPincode && !destPin) {
      throw new BadRequestException(`Destination pincode ${dto.destPincode} is not in the pincode master — add it under Pincodes before booking.`);
    }
    const originZone = this.productZone(originPin, dto.product, dto.serviceMode, dto.originPincode, dto.originZone) || dto.originZone;
    const destZone = this.productZone(destPin, dto.product, dto.serviceMode, dto.destPincode, dto.destZone) || dto.destZone;
    let isOda = dto.isOda ?? false;
    if (destPin && (destPin.isOda || (destPin.edl && destPin.edl.toUpperCase() !== 'REGULAR'))) isOda = true;

    // Promised delivery = booking date + vendor-specific zone→zone transit TAT.
    const expectedDelivery = await this.expectedDeliveryFor(dto.product, dto.serviceMode, originZone, destZone, (dto as any).vendor);

    const pieces = dto.pieces.map((p, i) => {
      const sequenceNo = i + 1;
      const childId = `${awb}-${String(sequenceNo).padStart(3, '0')}`;
      return {
        childId,
        sequenceNo,
        barcodeValue: childId, // payload encoded on the Code128/QR
        deadKg: new Prisma.Decimal(p.deadKg),
        lengthCm: p.lengthCm != null ? new Prisma.Decimal(p.lengthCm) : null,
        widthCm: p.widthCm != null ? new Prisma.Decimal(p.widthCm) : null,
        heightCm: p.heightCm != null ? new Prisma.Decimal(p.heightCm) : null,
        volKg: new Prisma.Decimal(this.volKg(p.lengthCm, p.widthCm, p.heightCm)),
      };
    });

    const totalDeadKg = pieces.reduce((s, p) => s + Number(p.deadKg), 0);
    const totalVolKg = pieces.reduce((s, p) => s + Number(p.volKg), 0);

    const lrNumber = awb.replace(COMPANY.awbPrefix, 'GC'); // Goods Consignment note no.

    // Auto e-way bill: if invoice value ≥ ₹50k and no EWB number was supplied,
    // generate one at booking (SANDBOX — wire a GSP for live generation).
    const EWB_THRESHOLD = 50000;
    let ewbNo = dto.ewbNo?.trim() || null;
    let ewbValidUpto: Date | null = null;
    if (!ewbNo && dto.declaredValue != null && dto.declaredValue >= EWB_THRESHOLD) {
      ewbNo = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
      ewbValidUpto = new Date(Date.now() + 86400000); // 1-day default validity
    }

    const created = await this.prisma.shipment.create({
      data: {
        awb,
        lrNumber,
        clientId: BigInt(dto.clientId),
        serviceMode: dto.serviceMode,
        originHubId: dto.originHubId != null && String(dto.originHubId) !== '' ? BigInt(dto.originHubId) : null,
        destHubId: dto.destHubId != null && String(dto.destHubId) !== '' ? BigInt(dto.destHubId) : null,
        originZone,
        destZone,
        pieceCount: total,
        totalDeadKg: new Prisma.Decimal(totalDeadKg.toFixed(3)),
        totalVolKg: new Prisma.Decimal(totalVolKg.toFixed(3)),
        consigneeName: dto.consigneeName,
        consigneePhone: dto.consigneePhone,
        consigneeAddress: dto.consigneeAddress,
        consigneeCity: dto.consigneeCity,
        destPincode: dto.destPincode,
        isOda,
        expectedDelivery,
        statusCode: 'MAN', statusAt: new Date(),
        // ---- shipper (sender) ----
        shipperName: dto.shipperName || null,
        shipperContact: dto.shipperContact || null,
        shipperAddress1: dto.shipperAddress1 || null,
        shipperAddress2: dto.shipperAddress2 || null,
        shipperPincode: dto.shipperPincode || null,
        shipperCity: dto.shipperCity || null,
        shipperState: dto.shipperState || null,
        shipperPhone: dto.shipperPhone || null,
        shipperMobile: dto.shipperMobile || null,
        shipperEmail: dto.shipperEmail || null,
        shipperCountry: dto.shipperCountry || null,
        shipperIec: dto.shipperIec || null,
        shipperGstin: dto.shipperGstin || null,
        shipperDocType: dto.shipperDocType || null,
        shipperDocNo: dto.shipperDocNo || null,
        originLocation: dto.originLocation || null,
        // ---- consignee extras ----
        consigneeContact: dto.consigneeContact || null,
        consigneeState: dto.consigneeState || null,
        consigneeCountry: dto.consigneeCountry || null,
        consigneeIec: dto.consigneeIec || null,
        consigneeDocType: dto.consigneeDocType || null,
        consigneeDocNo: dto.consigneeDocNo || null,
        // ---- services extras ----
        vendor: dto.vendor || null,
        service: dto.service || null,
        forwardingAwb: (dto as any).forwardingAwb || null,
        shipmentValue: dto.shipmentValue != null ? new Prisma.Decimal(dto.shipmentValue) : null,
        isCommercial: dto.isCommercial ?? false,
        isMedical: dto.isMedical ?? false,
        apptDelivery: dto.apptDelivery ?? false,
        referenceNo: dto.referenceNo || null,
        goodsDesc: dto.goodsDesc,
        hsnCode: dto.hsnCode,
        consignorGstin: dto.consignorGstin,
        consigneeGstin: dto.consigneeGstin,
        declaredValue: dto.declaredValue != null ? new Prisma.Decimal(dto.declaredValue) : null,
        ewbNo,
        ewbValidUpto,
        product: dto.product || null,
        docType: dto.docType || null,
        chargeWeight: dto.chargeWeight != null ? new Prisma.Decimal(dto.chargeWeight) : null,
        charges: dto.charges && dto.charges.length ? (dto.charges as any) : undefined,
        vehicleNo: dto.vehicleNo,
        ftlVehicleType: dto.ftlVehicleType,
        departureAt: dto.departureAt ? new Date(dto.departureAt) : null,
        arrivalAt: dto.arrivalAt ? new Date(dto.arrivalAt) : null,
        manualFreight: dto.manualFreight != null ? new Prisma.Decimal(dto.manualFreight) : null,
        // payment terms
        paymentTerm: dto.paymentTerm ?? 'PREPAID',
        freightToCollect:
          dto.paymentTerm === 'TO_PAY' && dto.freightToCollect != null
            ? new Prisma.Decimal(dto.freightToCollect)
            : null,
        // DOD (Draft on Delivery)
        isDod: dto.isDod ?? false,
        dodAmount: dto.isDod && dto.dodAmount != null ? new Prisma.Decimal(dto.dodAmount) : null,
        dodInstrument: dto.isDod ? dto.dodInstrument ?? null : null,
        pieces: { create: pieces },
      },
      include: { pieces: { orderBy: { sequenceNo: 'asc' } } },
    });
    // First milestone: MAN (Manifested) — the timeline always opens here at booking / API push.
    await this.prisma.scanLog.create({ data: { awb, eventType: 'MAN', remark: manualAwb ? 'Booked (manual AWB)' : 'Booked' } });
    return created;
  }

  /**
   * Bulk booking — create many shipments from a list (e.g. an uploaded sheet).
   * Each row is created independently; failures are reported per-row, not fatal.
   */
  async bulkCreate(rows: CreateShipmentDto[]) {
    const results: { row: number; ok: boolean; awb?: string; error?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const sh = await this.create(rows[i]);
        results.push({ row: i + 1, ok: true, awb: sh.awb });
      } catch (e: any) {
        results.push({ row: i + 1, ok: false, error: e?.message || 'Failed to create' });
      }
    }
    return { total: rows.length, created: results.filter((r) => r.ok).length, results };
  }

  /**
   * Super-admin: permanently delete the given AWBs and all their child records (pieces, scans,
   * PODs, invoice lines, notes, claims). FK-safe. Invoices themselves are kept (only the lines
   * for these shipments are removed). Used by the "select + delete" controls on the AWB list.
   */
  async bulkDelete(awbs: string[]) {
    const list = (awbs || []).map((a) => String(a).trim().toUpperCase()).filter(Boolean);
    if (!list.length) return { ok: true, deleted: 0, detail: {} };
    const shipments = await this.prisma.shipment.findMany({ where: { awb: { in: list } }, select: { id: true, awb: true } });
    const sIds = shipments.map((s) => s.id);
    const awbList = shipments.map((s) => s.awb);
    if (!sIds.length) return { ok: true, deleted: 0, detail: {} };
    const pieces = await this.prisma.shipmentPiece.findMany({ where: { shipmentId: { in: sIds } }, select: { id: true } });
    const pieceIds = pieces.map((x) => x.id);
    const r: Record<string, number> = {};
    const del = async (k: string, fn: () => Promise<{ count: number }>) => { r[k] = (await fn()).count; };
    await del('scanEvents', () => this.prisma.scanEvent.deleteMany({ where: { pieceId: { in: pieceIds } } }));
    await del('scanLogs', () => this.prisma.scanLog.deleteMany({ where: { awb: { in: awbList } } }));
    await del('pods', () => this.prisma.pod.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('invoiceLines', () => this.prisma.invoiceLineItem.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('debitCreditNotes', () => this.prisma.debitCreditNote.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('claims', () => this.prisma.claim.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('shipmentPieces', () => this.prisma.shipmentPiece.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('shipments', () => this.prisma.shipment.deleteMany({ where: { id: { in: sIds } } }));
    return { ok: true, deleted: shipments.length, detail: r };
  }

  // ---- Per-AWB add-on charges (ad-hoc, billed to the customer on the next invoice when toBill) ----
  private async shipmentByAwb(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb: String(awb).trim().toUpperCase() }, select: { id: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    return s;
  }

  async listAddons(awb: string) {
    const s = await this.shipmentByAwb(awb);
    return this.prisma.shipmentAddon.findMany({ where: { shipmentId: s.id }, orderBy: { createdAt: 'desc' } });
  }

  async addAddon(awb: string, dto: any, userId?: number) {
    const s = await this.shipmentByAwb(awb);
    const amount = Number(dto.amount) || 0;
    if (!(amount > 0)) throw new BadRequestException('Enter an amount greater than zero.');
    return this.prisma.shipmentAddon.create({
      data: {
        shipmentId: s.id,
        amount,
        reason: String(dto.reason || '').trim() || 'Add-on charge',
        serviceCentre: dto.serviceCentre?.trim() || null,
        fromLoc: dto.fromLoc?.trim() || null,
        toLoc: dto.toLoc?.trim() || null,
        mode: dto.mode?.trim() || null,
        toBill: dto.toBill !== false,
        pickupDate: dto.pickupDate ? new Date(dto.pickupDate) : null,
        createdById: userId != null ? BigInt(userId) : null,
      },
    });
  }

  async removeAddon(id: number) {
    const a = await this.prisma.shipmentAddon.findUnique({ where: { id: BigInt(id) }, select: { billedInvoiceId: true } });
    if (a?.billedInvoiceId) throw new ConflictException('This add-on is already billed on an invoice — cancel/rebill that invoice first.');
    await this.prisma.shipmentAddon.delete({ where: { id: BigInt(id) } });
    return { ok: true };
  }

  // ---- Customer-portal self-service (CLIENT_ADMIN, own shipments only) ----
  private async ownedShipment(awb: string, clientId: number) {
    const s = await this.prisma.shipment.findUnique({ where: { awb: String(awb).trim().toUpperCase() }, select: { id: true, clientId: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    const allowed = await this.bookableAccountIds(clientId);
    if (!allowed.has(String(s.clientId))) throw new ForbiddenException('This shipment is not on your account.');
    return s;
  }

  /** Customer sets an appointment-delivery date/time + optional morning remark on their own AWB. */
  async portalAppointment(awb: string, clientId: number, dto: { date?: string; remark?: string }) {
    const s = await this.ownedShipment(awb, clientId);
    const date = dto.date ? new Date(dto.date) : null;
    await this.prisma.shipment.update({
      where: { id: s.id },
      data: { apptDelivery: date != null, apptDate: date, customerRemark: dto.remark?.trim() || null, customerRemarkAt: new Date() },
    });
    return { ok: true };
  }

  /** Customer leaves a remark against their AWB (e.g. a contact number) — shown to CS + on tracking. */
  async portalRemark(awb: string, clientId: number, dto: { remark: string }) {
    const s = await this.ownedShipment(awb, clientId);
    const remark = String(dto.remark || '').trim();
    if (!remark) throw new BadRequestException('Enter a remark.');
    await this.prisma.shipment.update({ where: { id: s.id }, data: { customerRemark: remark, customerRemarkAt: new Date() } });
    return { ok: true };
  }

  /**
   * Estimate the cost of a hypothetical shipment (portal rate-check, gated by canCheckRates).
   * Builds a synthetic shipment, derives zones from the pincode master, and runs the live rate engine.
   */
  async estimate(clientId: number, dto: { product: string; vendor?: string; originPincode: string; destPincode: string; deadKg: number; pcs?: number; declaredValue?: number }) {
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) }, select: { canCheckRates: true } });
    if (!client?.canCheckRates) throw new ForbiddenException('Rate check is not enabled for your account. Please contact us.');
    if (!dto.product || !dto.destPincode) throw new BadRequestException('Product and destination pincode are required.');

    const [originPin, destPin] = await Promise.all([
      dto.originPincode ? this.prisma.pincode.findFirst({ where: { pincode: String(dto.originPincode) } }) : Promise.resolve(null),
      this.prisma.pincode.findFirst({ where: { pincode: String(dto.destPincode) } }),
    ]);
    const originZone = this.productZone(originPin, dto.product, undefined, dto.originPincode, 'SOUTH') || 'SOUTH';
    const destZone = this.productZone(destPin, dto.product, undefined, dto.destPincode, 'SOUTH') || 'SOUTH';
    const pcs = Math.max(1, Math.floor(Number(dto.pcs) || 1));
    const totalKg = Number(dto.deadKg) || 0.5;
    const pieces = Array.from({ length: pcs }, () => ({ deadKg: totalKg / pcs, volKg: 0, lengthCm: null, widthCm: null, heightCm: null }));
    const isOda = !!(destPin?.edl && String(destPin.edl).toUpperCase() !== 'REGULAR');

    const shipment: any = {
      clientId: BigInt(clientId), product: dto.product, vendor: dto.vendor || 'SELF',
      originZone, destZone, originPincode: dto.originPincode, destPincode: dto.destPincode,
      declaredValue: Number(dto.declaredValue) || 0, shipmentValue: Number(dto.declaredValue) || 0,
      pieceCount: pcs, isOda,
    };
    const charges = await this.rates.chargesForShipment(shipment, pieces);
    if (!charges) return { ok: false, message: 'No rate is configured for this product yet — please contact us for a quote.' };
    const gst = +(Number(charges.subtotal) * 0.18).toFixed(2);
    return {
      ok: true, subtotal: charges.subtotal, gst, total: +(Number(charges.subtotal) + gst).toFixed(2),
      chargeableKg: charges.chargeableKg, isOda, lines: charges.lines, basis: charges.basis,
    };
  }

  /** Wrong-entry transfer: reassign a mis-booked AWB to the correct customer. Blocked once the
   *  shipment has been invoiced (cancel/rebill the invoice first). Super-admin action. */
  async transfer(awb: string, clientId: number) {
    const s = await this.prisma.shipment.findUnique({
      where: { awb: String(awb).trim().toUpperCase() },
      select: { id: true, clientId: true, _count: { select: { invoiceLines: true } } },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (s._count.invoiceLines > 0) throw new ConflictException('This AWB is already invoiced — cancel/rebill the invoice before transferring.');
    const target = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) }, select: { id: true, legalName: true, accountCode: true } });
    if (!target) throw new NotFoundException('Target customer not found');
    await this.prisma.shipment.update({ where: { id: s.id }, data: { clientId: target.id } });
    return { awb, transferredTo: { id: String(target.id), legalName: target.legalName, accountCode: target.accountCode } };
  }

  /** Cancel a shipment. A client (clientId set) can cancel only their OWN AWB, and only before it's
   *  dispatched (still MAN/PKD) and not yet invoiced. Staff can cancel any non-invoiced pre-dispatch AWB. */
  async cancel(awbRaw: string, userId?: bigint, clientId?: number, reason?: string) {
    const awb = String(awbRaw).trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, clientId: true, statusCode: true, _count: { select: { invoiceLines: true } } },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (clientId != null && String(s.clientId) !== String(clientId)) throw new NotFoundException(`AWB ${awb} not found`); // don't leak others' AWBs
    if (s._count.invoiceLines > 0) throw new ConflictException('This AWB is already invoiced — it cannot be cancelled.');
    const cur = String(s.statusCode || 'MAN').toUpperCase();
    if (!['MAN', 'PKD'].includes(cur)) throw new ConflictException(`AWB is already ${cur} (in transit) — it can no longer be cancelled online. Contact support.`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { statusCode: 'CAN', status: 'CANCELLED' as any, statusAt: new Date(), exceptionFlag: reason || 'Cancelled by customer' } });
    await this.prisma.scanLog.create({ data: { awb, eventType: 'CAN', remark: reason || 'Cancelled', scannedById: userId ?? null } });
    return { awb, status: 'CAN' };
  }

  /**
   * DOD — record that the cheque/DD was collected from the consignee.
   * This is the delivery gate: POD is blocked (see PodsService) until this is set.
   */
  async collectDod(
    awb: string,
    dto: { reference: string; bankName?: string; amount?: number },
    userId: bigint,
  ) {
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, isDod: true, dodCollectedAt: true, dodAmount: true },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (!s.isDod) throw new ForbiddenException(`${awb} is not a DOD shipment.`);
    if (s.dodCollectedAt) throw new ForbiddenException(`DOD already collected for ${awb}.`);
    if (!dto.reference?.trim()) throw new ForbiddenException('Cheque / DD reference number is required.');

    const updated = await this.prisma.shipment.update({
      where: { id: s.id },
      data: {
        dodReference: dto.reference.trim(),
        dodBankName: dto.bankName?.trim() || null,
        dodAmount: dto.amount != null ? new Prisma.Decimal(dto.amount) : s.dodAmount,
        dodCollectedAt: new Date(),
        dodCollectedById: userId,
      },
      select: { awb: true, dodReference: true, dodBankName: true, dodAmount: true, dodCollectedAt: true },
    });
    return { ...updated, message: `DOD collected — delivery unlocked for ${awb}.` };
  }

  /** DOD — record handover of the collected draft to the consignor. */
  async handoverDod(awb: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, isDod: true, dodCollectedAt: true, dodHandedOverAt: true },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (!s.isDod) throw new ForbiddenException(`${awb} is not a DOD shipment.`);
    if (!s.dodCollectedAt) throw new ForbiddenException(`Collect the DOD draft before handing it over.`);
    if (s.dodHandedOverAt) throw new ForbiddenException(`DOD already handed over for ${awb}.`);
    const updated = await this.prisma.shipment.update({
      where: { id: s.id },
      data: { dodHandedOverAt: new Date() },
      select: { awb: true, dodHandedOverAt: true },
    });
    return { ...updated, message: `DOD draft handed over to consignor for ${awb}.` };
  }

  /** To-Pay — record the freight collected from the consignee at delivery. */
  async collectFreight(awb: string, amount: number, userId: bigint) {
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, paymentTerm: true, freightCollectedAt: true },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (s.paymentTerm !== 'TO_PAY') throw new ForbiddenException(`${awb} is not a To-Pay shipment.`);
    if (s.freightCollectedAt) throw new ForbiddenException(`Freight already collected for ${awb}.`);
    if (!(amount > 0)) throw new ForbiddenException('Collected amount must be greater than zero.');
    const updated = await this.prisma.shipment.update({
      where: { id: s.id },
      data: {
        freightCollected: new Prisma.Decimal(amount),
        freightCollectedAt: new Date(),
        freightCollectedById: userId,
      },
      select: { awb: true, freightCollected: true, freightCollectedAt: true },
    });
    return { ...updated, message: `₹${amount} freight collected for ${awb}.` };
  }

  /**
   * Booking-time payment (cash counter / wallet). CASH records the amount; WALLET debits
   * the customer's prepaid wallet (blocks on insufficient balance) + posts a ledger entry.
   * Returns receipt data.
   */
  async payAtBooking(awb: string, dto: { amount: number; method?: string }, userId: bigint) {
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, clientId: true, freightCollectedAt: true, client: { select: { legalName: true, accountCode: true, walletBalance: true } } },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (s.freightCollectedAt) throw new ForbiddenException(`Payment already recorded for ${awb}.`);
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new ForbiddenException('Amount must be greater than zero.');
    const method = String(dto.method || 'CASH').toUpperCase() === 'WALLET' ? 'WALLET' : 'CASH';

    let walletBalance: number | null = null;
    if (method === 'WALLET') {
      const bal = Number(s.client.walletBalance);
      if (bal < amount) throw new ForbiddenException(`Insufficient wallet balance: ₹${bal} available, ₹${amount} required.`);
      walletBalance = +(bal - amount).toFixed(2);
      await this.prisma.b2bClient.update({ where: { id: s.clientId }, data: { walletBalance: new Prisma.Decimal(walletBalance) } });
      await this.prisma.ledgerEntry.create({ data: { clientId: s.clientId, entryType: `wallet_debit:${awb}`, amount: new Prisma.Decimal(amount), balanceAfter: new Prisma.Decimal(walletBalance) } });
    }
    await this.prisma.shipment.update({
      where: { id: s.id },
      data: { freightCollected: new Prisma.Decimal(amount), freightCollectedAt: new Date(), freightCollectedById: userId },
    });
    return { awb, method, amount, walletBalance, customer: s.client.legalName, accountCode: s.client.accountCode, collectedAt: new Date(), message: `₹${amount} collected via ${method} for ${awb}.` };
  }

  /**
   * Hand-off to a vendor: record which vendor carried the shipment + the vendor/carrier AWB
   * (forwarding AWB) as a reference. Links our AWB to the carrier's — used by vendor-bill P&L
   * matching. (BlueDart auto-fetches this once the integration is live.)
   */
  async setForwarding(awb: string, dto: { vendor?: string; forwardingAwb?: string }) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    const forwardingAwb = dto.forwardingAwb ? String(dto.forwardingAwb).trim() : null;
    const updated = await this.prisma.shipment.update({
      where: { id: s.id },
      data: {
        vendor: dto.vendor ? String(dto.vendor).trim() : undefined,
        forwardingAwb,
        forwardingAt: forwardingAwb ? new Date() : undefined,
      },
      select: { awb: true, vendor: true, forwardingAwb: true, forwardingAt: true },
    });
    return { ...updated, message: `${awb} forwarded${updated.vendor ? ' via ' + updated.vendor : ''}${forwardingAwb ? ' — ref ' + forwardingAwb : ''}.` };
  }

  /**
   * Edit an existing AWB after creation (#11): product, consignee, vendor, values, etc. Blocked once
   * the AWB is invoiced (cancel/rebill first). Changing product or a pincode re-derives the zone grid,
   * ODA flag and EDD so rating stays correct. Charges are computed live, so no stored total to patch.
   */
  async editShipment(awbRaw: string, dto: any, opts?: { isSuper?: boolean }) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { _count: { select: { invoiceLines: true } } } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    // Invoiced shipments are locked — EXCEPT a super-admin who explicitly overrides (the edit does NOT
    // retro-change the already-raised invoice; cancel/rebill for billing changes).
    if (s._count.invoiceLines > 0 && !(opts?.isSuper && dto?.overrideInvoiced)) {
      throw new ConflictException('This AWB is already invoiced — cancel/rebill the invoice before editing.');
    }

    const data: any = {};
    const str = (k: string, v: any) => { if (v !== undefined) data[k] = v === null || String(v).trim() === '' ? null : String(v).trim(); };
    const upper = (k: string, v: any) => { if (v !== undefined) data[k] = v ? String(v).trim().toUpperCase() : null; };
    const dec = (k: string, v: any) => { if (v !== undefined) data[k] = v != null && v !== '' && !isNaN(Number(v)) ? new Prisma.Decimal(Number(v)) : null; };

    str('consigneeName', dto.consigneeName);
    str('consigneePhone', dto.consigneePhone);
    str('consigneeAddress', dto.consigneeAddress);
    str('consigneeCity', dto.consigneeCity);
    str('consigneeState', dto.consigneeState);
    str('consigneeGstin', dto.consigneeGstin);
    str('goodsDesc', dto.goodsDesc);
    str('hsnCode', dto.hsnCode);
    str('shipperName', dto.shipperName);
    str('referenceNo', dto.referenceNo);
    str('service', dto.service);
    upper('product', dto.product);
    upper('vendor', dto.vendor);
    if (dto.docType !== undefined) data.docType = dto.docType || null;
    if (dto.paymentTerm !== undefined) data.paymentTerm = dto.paymentTerm;
    dec('shipmentValue', dto.shipmentValue);
    dec('declaredValue', dto.declaredValue);
    dec('chargeWeight', dto.chargeWeight);

    // Pincode / product changes → re-derive zones, ODA and EDD.
    const newDestPin = dto.destPincode !== undefined ? (String(dto.destPincode || '').trim() || null) : s.destPincode;
    const newOriginPin = dto.shipperPincode !== undefined ? (String(dto.shipperPincode || '').trim() || null) : s.shipperPincode;
    if (dto.destPincode !== undefined) data.destPincode = newDestPin;
    if (dto.shipperPincode !== undefined) data.shipperPincode = newOriginPin;
    const newProduct = dto.product !== undefined ? (data.product ?? s.product) : s.product;
    const productChanged = dto.product !== undefined && data.product !== s.product;
    const destChanged = dto.destPincode !== undefined && newDestPin !== s.destPincode;
    const originChanged = dto.shipperPincode !== undefined && newOriginPin !== s.shipperPincode;

    if (productChanged || destChanged || originChanged) {
      const [originPin, destPin] = await Promise.all([
        newOriginPin ? this.prisma.pincode.findUnique({ where: { pincode: newOriginPin } }) : null,
        newDestPin ? this.prisma.pincode.findUnique({ where: { pincode: newDestPin } }) : null,
      ]);
      if (newDestPin && !destPin) throw new BadRequestException(`Destination pincode ${newDestPin} is not in the pincode master.`);
      const originZone = this.productZone(originPin, newProduct, s.serviceMode, newOriginPin ?? undefined, s.originZone) || s.originZone;
      const destZone = this.productZone(destPin, newProduct, s.serviceMode, newDestPin ?? undefined, s.destZone) || s.destZone;
      data.originZone = originZone;
      data.destZone = destZone;
      if (destPin && (destPin.isOda || (destPin.edl && String(destPin.edl).toUpperCase() !== 'REGULAR'))) data.isOda = true;
      data.expectedDelivery = await this.expectedDeliveryFor(newProduct ?? undefined, s.serviceMode, originZone, destZone, data.vendor ?? s.vendor ?? undefined);
    }

    await this.prisma.shipment.update({ where: { id: s.id }, data });
    return { ok: true, awb, message: `${awb} updated.`, rezoned: productChanged || destChanged || originChanged };
  }

  /** Recent shipments, optionally scoped to a single client, with light rollup. */
  /** Xpresion-style AWB Entry List rows (flat, filter/grid-friendly). */
  async awbList(clientId: bigint | undefined, limit: number) {
    const shipments = await this.prisma.shipment.findMany({
      where: clientId != null ? { clientId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      include: { client: { select: { legalName: true, accountCode: true } }, _count: { select: { invoiceLines: true } } },
    });
    return shipments.map((s) => ({
      awb: s.awb,
      invoiced: s._count.invoiceLines > 0,
      bookDate: s.createdAt,
      shipperName: s.client.legalName, // client is the shipper unless a separate shipper is captured
      customerCode: s.client.accountCode,
      customerName: s.client.legalName,
      consigneeName: s.consigneeName ?? '',
      destination: s.consigneeCity ?? s.destPincode ?? s.destZone,
      product: s.product ?? '',
      vendor: s.vendor ?? (s.bdWaybill ? 'BLUEDART' : 'SELF'),
      forwardingAwb: s.forwardingAwb ?? s.bdWaybill ?? null,
      actualWeight: Number(s.totalDeadKg),
      chargeWeight: s.chargeWeight != null ? Number(s.chargeWeight) : Math.max(Number(s.totalDeadKg), Number(s.totalVolKg)),
      pieces: s.pieceCount,
      deliveryVendor: s.bdWaybill ?? s.awb, // carrier waybill; self = own AWB
      status: s.status,
    }));
  }

  async list(clientId: bigint | undefined, limit: number) {
    const shipments = await this.prisma.shipment.findMany({
      where: clientId != null ? { clientId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { pieces: { select: { status: true } }, client: { select: { legalName: true } } },
    });
    return shipments.map((s) => {
      const delivered = s.pieces.filter((p) => p.status === 'DELIVERED').length;
      return {
        id: s.id,
        awb: s.awb,
        client: s.client.legalName,
        serviceMode: s.serviceMode,
        route: `${s.originZone} -> ${s.destZone}`,
        status: s.status,
        pieceCount: s.pieceCount,
        delivered,
        totalDeadKg: s.totalDeadKg,
        totalVolKg: s.totalVolKg,
        createdAt: s.createdAt,
      };
    });
  }

  /** Assign a rider for last-mile delivery. */
  async assignDelivery(awb: string, riderId: number) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    await this.prisma.shipment.update({ where: { id: s.id }, data: { deliveryRiderId: BigInt(riderId) } });
    return { awb, deliveryRiderId: riderId };
  }

  /** Rider marks the consignment Out For Delivery — OFD scan on every box. */
  async markOfd(awb: string, riderId: bigint) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { pieces: { select: { id: true } } } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    const now = new Date();
    await this.prisma.scanEvent.createMany({
      data: s.pieces.map((p, i) => ({
        clientEventId: randomUUID(),
        pieceId: p.id,
        checkpoint: ScanCheckpoint.OUT_FOR_DELIVERY,
        scannedById: riderId,
        scannedAt: now,
        deviceSeq: BigInt(i + 1),
      })),
    });
    await this.prisma.shipmentPiece.updateMany({
      where: { shipmentId: s.id },
      data: { status: PieceStatus.OUT_FOR_DELIVERY },
    });
    await this.prisma.shipment.update({
      where: { id: s.id },
      data: { status: ShipmentStatus.OUT_FOR_DELIVERY, deliveryRiderId: s.deliveryRiderId ?? riderId },
    });
    await this.notifications.notify({
      channel: s.consigneePhone ? 'whatsapp' : 'inapp',
      recipient: s.consigneePhone ?? 'ops',
      kind: 'milestone',
      awb,
      shipmentId: s.id,
      message: `Your shipment ${awb} is out for delivery today.`,
    });
    return { awb, status: ShipmentStatus.OUT_FOR_DELIVERY };
  }

  /** Master AWB with per-piece status rollup. */
  /** Set (or clear) manual per-shipment charge overrides { CODE: amount }. Blocked once invoiced. */
  async setChargeOverrides(awbRaw: string, overrides: Record<string, number> | null) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, _count: { select: { invoiceLines: true } } },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (s._count.invoiceLines > 0) throw new ConflictException('This shipment is already invoiced — charges are locked.');
    let clean: Record<string, any> | null = null;
    if (overrides && typeof overrides === 'object') {
      const { _add, ...rest } = overrides as Record<string, any>;
      clean = Object.fromEntries(Object.entries(rest)
        .filter(([, v]) => v != null && v !== '' && !Array.isArray(v) && !isNaN(Number(v)))
        .map(([k, v]) => [k, +Number(v).toFixed(2)]));
      // Preserve ad-hoc added lines: [{ head, amount }].
      const add = Array.isArray(_add) ? _add
        .map((a: any) => ({ head: String(a?.head || '').trim(), amount: +Number(a?.amount || 0).toFixed(2) }))
        .filter((a: any) => a.head && a.amount) : [];
      if (add.length) clean._add = add;
    }
    await this.prisma.shipment.update({ where: { id: s.id }, data: { chargeOverrides: clean && Object.keys(clean).length ? clean : Prisma.DbNull } });
    return { ok: true, awb, overrides: clean };
  }

  async findByAwb(awb: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { awb },
      include: {
        pieces: { orderBy: { sequenceNo: 'asc' } },
        client: true,
        pods: { orderBy: { deliveredAt: 'desc' }, take: 1 },
        invoiceLines: { select: { invoiceId: true, invoice: { select: { invoiceNo: true } } }, take: 1 },
      },
    });
    if (!shipment) throw new NotFoundException(`AWB ${awb} not found`);

    const delivered = shipment.pieces.filter((p) => p.status === 'DELIVERED').length;
    return {
      ...shipment,
      invoiced: shipment.invoiceLines.length > 0,
      invoiceNo: shipment.invoiceLines[0]?.invoice?.invoiceNo ?? null,
      rollup: {
        pieceCount: shipment.pieceCount,
        delivered,
        isShort: delivered > 0 && delivered < shipment.pieceCount,
      },
    };
  }

  /**
   * Re-weigh at hub (revenue-leakage control). Records actual dead/volumetric
   * weight per box, then — for per-kg billing — raises a DEBIT note for the
   * freight delta between booked and re-weighed chargeable weight.
   */
  async reweigh(
    awb: string,
    lines: { sequenceNo: number; actualKg: number; lengthCm?: number; widthCm?: number; heightCm?: number }[],
    reweighedById?: number,
  ) {
    const shipment = await this.prisma.shipment.findUnique({ where: { awb }, include: { pieces: true } });
    if (!shipment) throw new NotFoundException(`AWB ${awb} not found`);

    const bySeq = new Map(lines.map((l) => [l.sequenceNo, l]));
    const now = new Date();

    // Charge on booked weights (baseline).
    const bookedCharge = await this.rates.chargesForShipment(shipment, shipment.pieces);

    // Apply re-weigh to each piece; build the re-weighed weight set.
    const reweighed = [] as { deadKg: number; volKg: number }[];
    for (const p of shipment.pieces) {
      const l = bySeq.get(p.sequenceNo);
      if (l) {
        const volKg = this.volKg(l.lengthCm, l.widthCm, l.heightCm) || Number(p.volKg);
        await this.prisma.shipmentPiece.update({
          where: { id: p.id },
          data: {
            reweighKg: new Prisma.Decimal(l.actualKg),
            reweighVolKg: new Prisma.Decimal(volKg),
            reweighedAt: now,
            reweighedById: reweighedById != null ? BigInt(reweighedById) : null,
          },
        });
        reweighed.push({ deadKg: l.actualKg, volKg });
      } else {
        reweighed.push({ deadKg: Number(p.deadKg), volKg: Number(p.volKg) });
      }
    }

    const newCharge = await this.rates.chargesForShipment({ ...shipment }, reweighed as any);
    const bookedKg = this.rates.chargeableKg(shipment.pieces);
    const actualKg = this.rates.chargeableKg(reweighed as any);

    let note: any = null;
    const delta = newCharge && bookedCharge ? +(newCharge.subtotal - bookedCharge.subtotal).toFixed(2) : 0;
    if (delta > 1) {
      const res = await this.notes.create({
        clientId: Number(shipment.clientId),
        kind: 'DEBIT',
        reason: 'weight_discrepancy',
        subtotal: delta,
        narration: `Re-weigh ${awb}: chargeable ${bookedKg}kg → ${actualKg}kg`,
        shipmentId: Number(shipment.id),
        createdById: reweighedById,
      });
      note = res.note;
    }

    return {
      awb,
      bookedChargeableKg: bookedKg,
      actualChargeableKg: actualKg,
      freightDelta: delta,
      debitNote: note ? { noteNo: note.noteNo, total: note.total } : null,
      billable: !!bookedCharge,
    };
  }
}
