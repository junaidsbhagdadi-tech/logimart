import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, ShipmentStatus, PieceStatus, ScanCheckpoint } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { pinRows, placeName } from '../../common/place-name';
import { COMPANY, VOLUMETRIC_DIVISOR } from '../../config/company';
import { regionFromPincode } from '../../common/regions';
import { RateService } from '../billing/rate.service';
import { NotesService } from '../notes/notes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DelhiveryService } from '../delhivery/delhivery.service';
import { BluedartService } from '../bluedart/bluedart.service';
import { StorageService } from '../storage/storage.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { EWB_PENDING_WHERE, isEwbPending, normaliseEwbNo } from './ewb';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RateService,
    private readonly notes: NotesService,
    private readonly notifications: NotificationsService,
    private readonly delhivery: DelhiveryService,
    private readonly bluedart: BluedartService,
    private readonly storage: StorageService,
  ) {}

  /** Volumetric weight in kg from cm dimensions. Uses the customer/product card's divisor and, for
   *  SURFACE cards, its CFT factor — so the stored/displayed volumetric matches what the engine bills
   *  (SFC no longer wrongly divides by 5000). Falls back to the default divisor when no card config. */
  private volKg(l?: number, w?: number, h?: number, divisor = VOLUMETRIC_DIVISOR, cft = 0): number {
    if (!l || !w || !h) return 0;
    const d = divisor > 0 ? divisor : VOLUMETRIC_DIVISOR;
    const base = (l * w * h) / d;
    return Number((cft > 0 ? base * cft : base).toFixed(3));
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

  async create(dto: CreateShipmentDto, opts?: { skipAutoDispatch?: boolean; createdById?: bigint }) {
    // Resolve the customer by internal id OR account code — bulk imports usually carry the account code.
    const cid = String((dto as any).clientId ?? '').trim();
    const sel = { id: true, isActive: true, isCreditHold: true, legalName: true, outstandingBal: true, creditLimit: true };
    let client = /^\d+$/.test(cid) ? await this.prisma.b2bClient.findUnique({ where: { id: BigInt(cid) }, select: sel }) : null;
    // Account-code match is case-insensitive (bulk sheets vary the case, e.g. "o0020" vs "O0020").
    if (!client && cid) client = await this.prisma.b2bClient.findFirst({ where: { accountCode: { equals: cid, mode: 'insensitive' } }, select: sel });
    // …and space-tolerant, in case the sheet cell carries a stray internal space ("O 0020").
    if (!client && /\s/.test(cid)) client = await this.prisma.b2bClient.findFirst({ where: { accountCode: { equals: cid.replace(/\s+/g, ''), mode: 'insensitive' } }, select: sel });
    if (!client) throw new NotFoundException(`Customer code "${cid}" not found — check the customer's exact Code (watch for letter "O" vs zero "0"), or add the customer with this code first.`);
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
      // A VOIDED (cancelled, never-invoiced) AWB — e.g. from an undone bulk upload — is re-bookable:
      // retire the void record and book the corrected row fresh. An active AWB is a duplicate.
      if (exists && !(await this.retireVoided(exists.id))) throw new ConflictException(`AWB ${manualAwb} already exists.`);
    }
    // Dedupe on the forwarding/carrier no too — so a re-uploaded row is caught even when our AWB differs.
    const fwd = (dto as any).forwardingAwb ? String((dto as any).forwardingAwb).trim().toUpperCase() : '';
    if (fwd) {
      const dup = await this.prisma.shipment.findFirst({ where: { forwardingAwb: { equals: fwd, mode: 'insensitive' } }, select: { id: true, awb: true } });
      if (dup && !(await this.retireVoided(dup.id))) throw new ConflictException(`Forwarding no ${fwd} already exists (on AWB ${dup.awb}).`);
      // A forwarding/carrier AWB must carry a vendor — the vendor drives billing rates. Booking one
      // with a blank vendor would silently bill SELF-network rates. Require the carrier at booking too.
      if (!(dto.vendor && String(dto.vendor).trim()))
        throw new BadRequestException(`Forwarding no ${fwd} needs a vendor — set the carrier so it isn't billed at SELF-network rates.`);
    }
    // DOD = a cheque/DD collected before release — it needs the amount (BlueDart also rejects ₹0 DOD).
    if (dto.isDod && !(Number(dto.dodAmount) > 0)) throw new BadRequestException('DOD is ticked but the DOD amount is empty — enter the cheque/DD value to collect, or untick DOD.');
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

    // Volumetric config for this customer × product × vendor (divisor + surface CFT), so the stored
    // volumetric matches the engine's billing basis (surface uses CFT, not ÷5000).
    const vc = await this.rates.volConfigFor(dto.clientId, String(dto.product ?? ''), (dto as any).vendor).catch(() => ({ divisor: VOLUMETRIC_DIVISOR, cft: 0 }));
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
        volKg: new Prisma.Decimal(this.volKg(p.lengthCm, p.widthCm, p.heightCm, vc.divisor, vc.cft)),
      };
    });

    const totalDeadKg = pieces.reduce((s, p) => s + Number(p.deadKg), 0);
    const totalVolKg = pieces.reduce((s, p) => s + Number(p.volKg), 0);

    const lrNumber = awb.replace(COMPANY.awbPrefix, 'GC'); // Goods Consignment note no.

    // E-way bill: store only a number the user actually entered. Invoice value ≥ ₹50k with none is
    // left blank and surfaces as "EWB pending" (see ./ewb.ts) for CS to fill via Edit AWB — never a
    // made-up number (it prints on AWB copies / manifests and goes to carriers). Flag, not reject, so
    // bulk uploads keep booking.
    const ewbNo = normaliseEwbNo(dto.ewbNo);

    const created = await this.prisma.shipment.create({
      data: {
        awb,
        lrNumber,
        ...(opts?.createdById ? { createdById: opts.createdById } : {}),
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
        // Derive the destination city from the pincode master when the caller omits it (bulk uploads
        // send only the pincode) — else the tracker shows the default hub code instead of the real city.
        consigneeCity: dto.consigneeCity || destPin?.city || null,
        destPincode: dto.destPincode,
        isOda,
        expectedDelivery,
        statusCode: 'MAN',
        // #2 — honour a manual booking date+time (backdated entry); default now.
        ...(dto.bookedAt ? { createdAt: new Date(dto.bookedAt) } : {}),
        statusAt: dto.bookedAt ? new Date(dto.bookedAt) : new Date(),
        // ---- shipper (sender) ----
        shipperName: dto.shipperName || null,
        shipperContact: dto.shipperContact || null,
        shipperAddress1: dto.shipperAddress1 || null,
        shipperAddress2: dto.shipperAddress2 || null,
        // Store the origin pincode: prefer the shipper's, else the `originPincode` (bulk upload sends
        // originPincode, which was only used to derive the zone and was never saved → origin blank).
        shipperPincode: dto.shipperPincode || dto.originPincode || null,
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
        originLocation: dto.originLocation || originPin?.city || null,
        // ---- consignee extras ----
        consigneeContact: dto.consigneeContact || null,
        consigneeState: dto.consigneeState || null,
        consigneeCountry: dto.consigneeCountry || null,
        consigneeIec: dto.consigneeIec || null,
        consigneeDocType: dto.consigneeDocType || null,
        consigneeDocNo: dto.consigneeDocNo || null,
        // ---- services extras ----
        vendor: dto.vendor || null,
        bdAccountId: (dto as any).bdAccountId ? BigInt((dto as any).bdAccountId) : null,
        service: dto.service || null,
        forwardingAwb: (dto as any).forwardingAwb || null,
        shipmentValue: dto.shipmentValue != null ? new Prisma.Decimal(dto.shipmentValue) : null,
        isCommercial: dto.isCommercial ?? false,
        isMedical: dto.isMedical ?? false,
        apptDelivery: dto.apptDelivery ?? false,
        referenceNo: dto.referenceNo || null,
        custInvoiceNo: (dto as any).invoiceNo || null,
        goodsDesc: dto.goodsDesc,
        hsnCode: dto.hsnCode,
        consignorGstin: dto.consignorGstin,
        consigneeGstin: dto.consigneeGstin,
        declaredValue: dto.declaredValue != null ? new Prisma.Decimal(dto.declaredValue) : null,
        ewbNo,
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
        fmPickup: (dto as any).fmPickup ?? null,
        dodAmount: dto.isDod && dto.dodAmount != null ? new Prisma.Decimal(dto.dodAmount) : null,
        dodInstrument: dto.isDod ? dto.dodInstrument ?? null : null,
        pieces: { create: pieces },
      },
      include: { pieces: { orderBy: { sequenceNo: 'asc' } } },
    });
    // First milestone: MAN (Manifested) — the timeline always opens here at booking / API push.
    // Stamp it at the booking date (backdated / bulk-uploaded entries), not the upload time (#17).
    await this.prisma.scanLog.create({ data: { awb, eventType: 'MAN', remark: manualAwb ? 'Booked (manual AWB)' : 'Booked', scanAt: created.createdAt } });
    // Single bookings: fetch the BlueDart AWB immediately — generate the waybill + register the pickup
    // in the background (non-blocking). Only when the shipment is a BlueDart carrier with no carrier AWB
    // yet. Bulk paths pass skipAutoDispatch and rely on the throttled auto-dispatch poller instead, so a
    // large upload never fires hundreds of BlueDart calls at once.
    if (!opts?.skipAutoDispatch && /BLUE|BDR/i.test(String((created as any).vendor || '')) && !(created as any).forwardingAwb && !(created as any).bdWaybill) {
      this.bluedart.autoDispatch(created.awb).catch(() => { /* captured on the shipment; poller retries */ });
    }
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
        const sh = await this.create(rows[i], { skipAutoDispatch: true });
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
    const found = await this.prisma.shipment.findMany({ where: { awb: { in: list } }, select: { id: true, awb: true, _count: { select: { invoiceLines: true } } } });
    // Never hard-delete an INVOICED AWB: it would strip lines off an issued (GST) invoice while its
    // total + ledger charge stay — the bill and the books would no longer match. Raise a credit note.
    const invoiced = found.filter((s) => s._count.invoiceLines > 0).map((s) => s.awb);
    const shipments = found.filter((s) => s._count.invoiceLines === 0);
    const notFound = list.filter((a) => !found.some((s) => s.awb === a));
    const sIds = shipments.map((s) => s.id);
    const awbList = shipments.map((s) => s.awb);
    if (!sIds.length) return { ok: true, deleted: 0, detail: {}, invoiced, notFound };
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
    await del('addons', () => this.prisma.shipmentAddon.deleteMany({ where: { shipmentId: { in: sIds } } })); // FK — else the delete fails
    await del('shipmentPieces', () => this.prisma.shipmentPiece.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('shipments', () => this.prisma.shipment.deleteMany({ where: { id: { in: sIds } } }));
    return { ok: true, deleted: shipments.length, detail: r, invoiced, notFound };
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
    // Clear the CS acknowledgement so a NEW remark lights the CS bell again.
    await this.prisma.shipment.update({ where: { id: s.id }, data: { customerRemark: remark, customerRemarkAt: new Date(), customerRemarkAckAt: null } });
    return { ok: true };
  }

  /** CS comments awaiting the customer (unread), across every account the login may book under. */
  async portalCsComments(clientId: number) {
    const allowed = [...(await this.bookableAccountIds(clientId))].map((x) => BigInt(x));
    if (!allowed.length) return [];
    const rows = await this.prisma.shipment.findMany({
      where: { clientId: { in: allowed }, csComment: { not: null }, csCommentReadAt: null },
      select: { awb: true, csComment: true, csCommentAt: true, consigneeName: true, consigneeCity: true, destPincode: true },
      orderBy: { csCommentAt: 'desc' }, take: 50,
    });
    return rows.map((r) => ({ awb: r.awb, comment: r.csComment, at: r.csCommentAt, consignee: r.consigneeName, destination: r.consigneeCity ?? r.destPincode }));
  }

  /** Customer acknowledges a CS comment — optionally replying, which goes to the CS bell as a remark. */
  async portalCsCommentRead(awb: string, clientId: number, dto: { reply?: string }) {
    const s = await this.ownedShipment(awb, clientId);
    const reply = String(dto?.reply || '').trim();
    await this.prisma.shipment.update({
      where: { id: s.id },
      data: { csCommentReadAt: new Date(), ...(reply ? { customerRemark: reply, customerRemarkAt: new Date(), customerRemarkAckAt: null } : {}) },
    });
    return { ok: true, replied: !!reply };
  }

  /**
   * Estimate the cost of a hypothetical shipment (portal rate-check, gated by canCheckRates).
   * Builds a synthetic shipment, derives zones from the pincode master, and runs the live rate engine.
   */
  async estimate(clientId: number, dto: { product: string; vendor?: string; originPincode: string; destPincode: string; deadKg: number; pcs?: number; declaredValue?: number }) {
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) }, select: { canCheckRates: true } });
    if (!client?.canCheckRates) throw new ForbiddenException('Rate check is not enabled for your account. Please contact us.');
    if (!dto.product || !dto.destPincode) throw new BadRequestException('Product and destination pincode are required.');
    return this.priceEstimate(clientId, dto);
  }

  /** Core rate-engine pricing for a portal estimate (no auth check — callers gate on canCheckRates). */
  private async priceEstimate(clientId: number, dto: { product: string; vendor?: string; originPincode: string; destPincode: string; deadKg: number; pcs?: number; declaredValue?: number; lengthCm?: number; widthCm?: number; heightCm?: number }) {
    const [originPin, destPin] = await Promise.all([
      dto.originPincode ? this.prisma.pincode.findFirst({ where: { pincode: String(dto.originPincode) } }) : Promise.resolve(null),
      this.prisma.pincode.findFirst({ where: { pincode: String(dto.destPincode) } }),
    ]);
    const originZone = this.productZone(originPin, dto.product, undefined, dto.originPincode, 'SOUTH') || 'SOUTH';
    const destZone = this.productZone(destPin, dto.product, undefined, dto.destPincode, 'SOUTH') || 'SOUTH';
    const pcs = Math.max(1, Math.floor(Number(dto.pcs) || 1));
    const totalKg = Number(dto.deadKg) || 0.5;
    const L = Number(dto.lengthCm) || null, W = Number(dto.widthCm) || null, H = Number(dto.heightCm) || null;
    const pieces = Array.from({ length: pcs }, () => ({ deadKg: totalKg / pcs, volKg: 0, lengthCm: L, widthCm: W, heightCm: H }));
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

  /** Portal rate-check across the customer's ASSIGNED vendors: a rate per vendor (to/from pincode,
   *  weight, dims, value). When the rate is SELF-based (same regardless of carrier) every assigned
   *  vendor shows that same rate. No assigned vendors → a single SELF quote. */
  async estimateVendors(clientId: number, dto: { product: string; originPincode: string; destPincode: string; deadKg: number; pcs?: number; declaredValue?: number; lengthCm?: number; widthCm?: number; heightCm?: number }) {
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) }, select: { canCheckRates: true, allowedVendors: true } });
    if (!client?.canCheckRates) throw new ForbiddenException('Rate check is not enabled for your account. Please contact us.');
    if (!dto.product || !dto.destPincode) throw new BadRequestException('Product and destination pincode are required.');
    const codes = (Array.isArray(client.allowedVendors) ? client.allowedVendors : []).map((c) => String(c).toUpperCase());
    const vendorsMaster = await this.prisma.vendor.findMany({ select: { vendorCode: true, name: true } });
    const nameOf = (code: string) => vendorsMaster.find((v) => String(v.vendorCode).toUpperCase() === code)?.name ?? code;
    const selfQuote = await this.priceEstimate(clientId, { ...dto, vendor: 'SELF' });
    if (!codes.length) return { ok: true, isOda: (selfQuote as any).isOda ?? false, rates: [{ vendor: 'SELF', name: 'Our network', ...selfQuote }] };
    const rates = await Promise.all(codes.map(async (code) => {
      const q = await this.priceEstimate(clientId, { ...dto, vendor: code }).catch(() => null);
      // Fall back to the SELF rate when the vendor has no distinct rate card (SELF → same for all).
      const eff = q && (q as any).ok ? q : selfQuote;
      return { vendor: code, name: nameOf(code), ...eff };
    }));
    return { ok: true, isOda: (selfQuote as any).isOda ?? false, rates };
  }

  /** #25 — effective volumetric divisor + CFT for the booking screen's per-box preview. */
  volConfig(clientId: number, product: string, vendor?: string) {
    return this.rates.volConfigFor(clientId, product, vendor);
  }

  /**
   * Price EVERY candidate carrier for a booking and return them cheapest-first, so ops can pick by
   * rate at booking (staff-side — no canCheckRates gate). Candidates = SELF plus every vendor that
   * has an active rate card for this customer×product. TAT (if configured) rides along for context.
   */
  async carrierRates(clientId: number, dto: { product: string; originPincode?: string; destPincode: string; deadKg?: number; pcs?: number; declaredValue?: number }) {
    if (!dto.product || !dto.destPincode) throw new BadRequestException('Product and destination pincode are required.');
    const now = new Date();
    const cards = await this.prisma.customerRateCard.findMany({
      where: { clientId: BigInt(clientId), isActive: true, product: { equals: dto.product, mode: 'insensitive' }, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
      select: { network: true },
    });
    const networks = [...new Set(['SELF', ...cards.map((c) => String(c.network || 'SELF').toUpperCase())])];

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
    const base: any = {
      clientId: BigInt(clientId), product: dto.product, originZone, destZone,
      originPincode: dto.originPincode, destPincode: dto.destPincode,
      declaredValue: Number(dto.declaredValue) || 0, shipmentValue: Number(dto.declaredValue) || 0,
      pieceCount: pcs, isOda,
    };

    const options: { vendor: string; freight: number; subtotal: number; gst: number; total: number; basis?: string }[] = [];
    for (const net of networks) {
      try {
        const charges = await this.rates.chargesForShipment({ ...base, vendor: net }, pieces);
        if (!charges) continue;
        const subtotal = Number(charges.subtotal);
        const gst = +(subtotal * 0.18).toFixed(2);
        options.push({ vendor: net, freight: Number(charges.freight), subtotal, gst, total: +(subtotal + gst).toFixed(2), basis: charges.basis });
      } catch { /* skip a carrier that can't be priced */ }
    }
    // Compare EVERY vendor's own cost card for this lane too (not just the customer's carded networks).
    try {
      const vendOpts = await this.rates.vendorCostOptions({ product: dto.product, originZone, destZone, kg: totalKg, bookedAt: new Date() });
      const seen = new Set(options.map((o) => o.vendor.toUpperCase()));
      for (const vo of vendOpts) { if (!seen.has(vo.vendor.toUpperCase())) { options.push(vo); seen.add(vo.vendor.toUpperCase()); } }
    } catch { /* vendor cost cards are optional */ }
    options.sort((a, b) => a.total - b.total);
    return { originZone, destZone, isOda, options };
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
  async cancel(awbRaw: string, userId?: bigint, clientId?: number, reason?: string, opts?: { isSuper?: boolean }) {
    const awb = String(awbRaw).trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, clientId: true, statusCode: true, vendor: true, forwardingAwb: true, bdWaybill: true, _count: { select: { invoiceLines: true } } },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (clientId != null && String(s.clientId) !== String(clientId)) throw new NotFoundException(`AWB ${awb} not found`); // don't leak others' AWBs
    if (s._count.invoiceLines > 0) throw new ConflictException('This AWB is already invoiced — raise a credit note instead of voiding.');
    const cur = String(s.statusCode || 'MAN').toUpperCase();
    if (cur === 'CAN') return { awb, status: 'CAN', already: true };
    // Normal cancel is limited to pre-transit (MAN/PKD). A super admin can VOID a wrong AWB at any
    // stage (never DLD/RTD) — voided AWBs are excluded from billing (invoice.service skips CANCELLED).
    if (!['MAN', 'PKD'].includes(cur) && !opts?.isSuper) {
      throw new ConflictException(`AWB is ${cur} (in transit) — only a super admin can void it. Contact support.`);
    }
    if (['DLD', 'RTD'].includes(cur)) throw new ConflictException(`AWB is ${cur} (delivered/returned) — it cannot be voided.`);

    // Best-effort: also cancel with the carrier if it was already handed off, so it isn't shipped/charged.
    const carrierNotes: string[] = [];
    const vend = String(s.vendor || '').toUpperCase();
    if (s.forwardingAwb && vend === 'DELHIVERY') {
      try { await this.delhivery.cancelLr(awb); carrierNotes.push('Delhivery LR cancelled'); }
      catch (e: any) { carrierNotes.push(`Delhivery cancel failed: ${e?.message ?? e}`); }
    } else if (s.bdWaybill) {
      // BlueDart has no single waybill-void API; flag for ops to cancel the pickup with BlueDart.
      carrierNotes.push(`BlueDart waybill ${s.bdWaybill} — cancel the pickup with BlueDart manually`);
    }

    const flag = [reason || 'Voided (wrong AWB)', ...carrierNotes].join(' · ');
    await this.prisma.shipment.update({ where: { id: s.id }, data: { statusCode: 'CAN', status: 'CANCELLED' as any, statusAt: new Date(), exceptionFlag: flag } });
    await this.prisma.scanLog.create({ data: { awb, eventType: 'CAN', remark: flag, scannedById: userId ?? null } });
    return { awb, status: 'CAN', carrier: carrierNotes };
  }

  /** Void several AWBs at once — runs the same guarded cancel() per AWB, collecting per-AWB results. */
  /**
   * #14 — Bulk change after the vendor bill (the team's own sheet format). Per row, BLANK = unchanged:
   * AWB (ours or the forwarding no) | Customer Code → transfer | Origin / Destination pincode, Vendor, Product
   * → edit (re-zones) | Weight → charge weight | Invoice value → shipment value | Booking Date → date change |
   * EDL / COD / Appointment / To-pay → per-AWB charge overrides (ODA / DOD / APPT / TOPAY).
   * Each row goes through the same guarded paths as the single-AWB tools, so invoiced AWBs are refused.
   */
  async bulkChange(rows: any[], opts: { isSuper?: boolean } = {}) {
    const blank = (v: any) => v == null || String(v).trim() === '';
    const results: { row: number; awb: string; ok: boolean; changed?: string[]; error?: string }[] = [];
    for (let i = 0; i < (rows || []).length; i++) {
      const r = rows[i] || {};
      const key = String(r.awb ?? '').trim().toUpperCase();
      if (!key) { results.push({ row: i + 1, awb: '', ok: false, error: 'AWB is blank' }); continue; }
      try {
        const s = await this.prisma.shipment.findFirst({
          where: { OR: [{ awb: key }, { forwardingAwb: { equals: key, mode: 'insensitive' } }, { bdWaybill: key }] },
          select: { awb: true, chargeOverrides: true, statusCode: true, _count: { select: { invoiceLines: true } } },
        });
        if (!s) throw new NotFoundException('AWB not found');
        if (['DLD', 'RTD'].includes(String(s.statusCode || '').toUpperCase()) && !opts.isSuper) throw new ConflictException('delivered — closed, only a super admin can change it');
        if (s._count.invoiceLines > 0) throw new ConflictException('already invoiced — cancel/rebill the invoice first');
        const changed: string[] = [];
        // Customer → transfer to that account.
        if (!blank(r.customerCode)) {
          const code = String(r.customerCode).trim();
          const c = await this.prisma.b2bClient.findFirst({ where: { accountCode: { equals: code, mode: 'insensitive' } }, select: { id: true } });
          if (!c) throw new NotFoundException(`customer code ${code} not found`);
          await this.transfer(s.awb, Number(c.id));
          changed.push('customer');
        }
        // Fields Edit AWB already handles (re-zones on pincode/product change).
        const patch: any = {};
        if (!blank(r.originPincode)) { patch.shipperPincode = String(r.originPincode).trim(); changed.push('origin'); }
        if (!blank(r.destPincode)) { patch.destPincode = String(r.destPincode).trim(); changed.push('destination'); }
        if (!blank(r.vendorCode)) { patch.vendor = String(r.vendorCode).trim(); changed.push('vendor'); }
        if (!blank(r.productCode)) { patch.product = String(r.productCode).trim(); changed.push('product'); }
        if (!blank(r.weight)) { const w = Number(r.weight); if (!(w > 0)) throw new BadRequestException(`weight "${r.weight}" is not a number`); patch.chargeWeight = w; changed.push('weight'); }
        if (!blank(r.invoiceValue)) { const v = Number(r.invoiceValue); if (!(v >= 0)) throw new BadRequestException(`invoice value "${r.invoiceValue}" is not a number`); patch.shipmentValue = v; changed.push('invoice value'); }
        // Charges from the vendor bill → per-AWB overrides (merged into any existing ones).
        const chg: Record<string, number> = {};
        const addChg = (col: any, code: string, label: string) => {
          if (blank(col)) return;
          const n = Number(col);
          if (isNaN(n) || n < 0) throw new BadRequestException(`${label} "${col}" is not a number`);
          chg[code] = n; changed.push(label);
        };
        addChg(r.edl, 'ODA', 'EDL'); addChg(r.cod, 'DOD', 'COD/DOD'); addChg(r.appointment, 'APPT', 'appointment'); addChg(r.topay, 'TOPAY', 'to-pay');
        if (Object.keys(patch).length) await this.editShipment(s.awb, patch, opts);
        if (Object.keys(chg).length) {
          const cur = s.chargeOverrides && typeof s.chargeOverrides === 'object' && !Array.isArray(s.chargeOverrides) ? (s.chargeOverrides as any) : {};
          await this.prisma.shipment.update({ where: { awb: s.awb }, data: { chargeOverrides: { ...cur, ...chg } } });
        }
        // Booking date last (moves the billing month).
        if (!blank(r.bookingDate)) {
          const d = await this.bulkChangeDate([s.awb], String(r.bookingDate).trim());
          const res = d.results?.[0];
          if (res && !res.ok) throw new BadRequestException(`booking date: ${res.error}`);
          changed.push('booking date');
        }
        if (!changed.length) throw new BadRequestException('nothing to change (all columns blank)');
        results.push({ row: i + 1, awb: s.awb, ok: true, changed });
      } catch (e: any) {
        results.push({ row: i + 1, awb: key, ok: false, error: e?.message ?? String(e) });
      }
    }
    return { total: results.length, changed: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
  }

  /**
   * Free a VOIDED shipment's AWB / LR / forwarding no so a corrected booking can reuse them (undo a
   * wrong upload → fix the sheet → re-upload). Only a cancelled (CAN), never-invoiced record qualifies;
   * returns false otherwise (the caller then treats it as a real duplicate). Nothing is deleted: the
   * void record is renamed `<AWB>-VOID<id>` along with its scan history and the old upload's job rows
   * (so undoing the old job can never touch the new booking), keeping the audit trail.
   */
  async retireVoided(shipmentId: bigint): Promise<boolean> {
    const s = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, awb: true, lrNumber: true, forwardingAwb: true, statusCode: true, _count: { select: { invoiceLines: true } } },
    });
    if (!s || s.statusCode !== 'CAN' || s._count.invoiceLines > 0) return false;
    const tag = `-VOID${s.id}`;
    const old = s.awb;
    const newAwb = old.endsWith(tag) ? old : `${old}${tag}`;
    await this.prisma.$transaction([
      this.prisma.shipment.update({
        where: { id: s.id },
        data: {
          awb: newAwb,
          lrNumber: s.lrNumber && !s.lrNumber.endsWith(tag) ? `${s.lrNumber}${tag}` : s.lrNumber,
          forwardingAwb: s.forwardingAwb && !s.forwardingAwb.endsWith(tag) ? `${s.forwardingAwb}${tag}` : s.forwardingAwb,
        },
      }),
      // Boxes too: their childId (`<AWB>-001`…) is unique, so leaving it made the corrected re-booking
      // fail with "Unique constraint failed on childId" for every voided AWB.
      this.prisma.$executeRaw`UPDATE shipment_pieces SET "childId" = "childId" || ${tag}, "barcodeValue" = "barcodeValue" || ${tag} WHERE "shipmentId" = ${s.id} AND "childId" NOT LIKE ${'%' + tag}`,
      this.prisma.scanLog.updateMany({ where: { awb: old }, data: { awb: newAwb } }),
      this.prisma.bulkBookingJobRow.updateMany({ where: { awb: old }, data: { awb: newAwb } }),
      this.prisma.notification.updateMany({ where: { awb: old }, data: { awb: newAwb } }),
    ]);
    return true;
  }

  async bulkCancel(awbs: string[], userId?: bigint, clientId?: number, reason?: string, opts?: { isSuper?: boolean }) {
    const list = [...new Set((awbs || []).map((a) => String(a).trim().toUpperCase()).filter(Boolean))];
    const results: { awb: string; ok: boolean; status?: string; error?: string }[] = [];
    for (const awb of list) {
      try { const r = await this.cancel(awb, userId, clientId, reason, opts); results.push({ awb, ok: true, status: r.status }); }
      catch (e: any) { results.push({ awb, ok: false, error: e?.message ?? String(e) }); }
    }
    return { total: list.length, voided: results.filter((r) => r.ok).length, results };
  }

  /** Change the booking date (createdAt) on several AWBs — for wrong-date corrections. Blocks
   *  already-invoiced AWBs (a date change would move their billing period). */
  async bulkChangeDate(awbs: string[], newDate: string, clientId?: number) {
    // Accept YYYY-MM-DD (date input) or DD-MM-YYYY / DD/MM/YYYY (typed), with optional HH:MM.
    const raw = String(newDate ?? '').trim();
    const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
    const when = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] ?? 10), Number(dmy[5] ?? 0)) : new Date(raw);
    if (isNaN(when.getTime())) throw new ConflictException('Invalid date — use DD-MM-YYYY.');
    if (when.getTime() > Date.now() + 86400000) throw new ConflictException('Booking date cannot be in the future.');
    const list = [...new Set((awbs || []).map((a) => String(a).trim().toUpperCase()).filter(Boolean))];
    const results: { awb: string; ok: boolean; error?: string }[] = [];
    for (const awb of list) {
      try {
        const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, clientId: true, createdAt: true, expectedDelivery: true, _count: { select: { invoiceLines: true } } } });
        if (!s) throw new NotFoundException(`AWB ${awb} not found`);
        if (clientId != null && String(s.clientId) !== String(clientId)) throw new NotFoundException(`AWB ${awb} not found`);
        if (s._count.invoiceLines > 0) throw new ConflictException('already invoiced — cannot change its date');
        // Move the whole booking: booking date, the manifest (MAN) scan the tracker shows as "Order Date",
        // and the promised delivery by the same shift (EDD = booking + TAT).
        const shift = when.getTime() - new Date(s.createdAt).getTime();
        await this.prisma.$transaction([
          this.prisma.shipment.update({
            where: { id: s.id },
            data: { createdAt: when, ...(s.expectedDelivery ? { expectedDelivery: new Date(new Date(s.expectedDelivery).getTime() + shift) } : {}) },
          }),
          this.prisma.scanLog.updateMany({ where: { awb, eventType: 'MAN' }, data: { scanAt: when } }),
        ]);
        results.push({ awb, ok: true });
      } catch (e: any) { results.push({ awb, ok: false, error: e?.message ?? String(e) }); }
    }
    return { total: list.length, changed: results.filter((r) => r.ok).length, date: when, results };
  }

  /** Minimal active-customer list for the pickup-boy (DRIVER) mobile booking picker. */
  async bookingCustomers(q?: string, scope?: bigint[] | null) {
    const s = String(q ?? '').trim();
    const where: any = { isActive: true, ...(scope ? { id: { in: scope } } : {}) };
    if (s) where.OR = [{ legalName: { contains: s, mode: 'insensitive' } }, { accountCode: { contains: s, mode: 'insensitive' } }];
    // Light picker for pickup boys / quick booking: identity + the pickup defaults (address, city, pincode,
    // phone, default carrier) — no credit / financial fields.
    const rows = await this.prisma.b2bClient.findMany({
      where, orderBy: { legalName: 'asc' }, take: 2000,
      select: { id: true, legalName: true, accountCode: true, addressLine: true, city: true, state: true, pincode: true, contactPhone: true, contactName: true, defaultVendor: true },
    });
    return rows.map((r) => ({ ...r, id: String(r.id) }));
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

  /** DOD cheque proof: the photo of the collected cheque/DD, and the courier AWB + date it was forwarded
   *  to the consignor under. Any field may be sent alone; blanks leave the stored value unchanged. */
  async dodCheque(awb: string, dto: { dataUrl?: string; courierAwb?: string; forwardedAt?: string; reference?: string }) {
    const s = await this.prisma.shipment.findUnique({ where: { awb: String(awb).trim().toUpperCase() }, select: { id: true, awb: true, isDod: true, product: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (!s.isDod && String(s.product ?? '').toUpperCase() !== 'DOD') throw new ForbiddenException(`${s.awb} is not a DOD shipment.`);
    const data: any = {};
    if (dto.dataUrl) {
      if (!String(dto.dataUrl).startsWith('data:image/')) throw new BadRequestException('Upload an image of the cheque (JPG/PNG).');
      data.dodChequeUrl = await this.storage.store(dto.dataUrl, 'dod-cheque');
    }
    if (dto.courierAwb != null && String(dto.courierAwb).trim()) data.dodCourierAwb = String(dto.courierAwb).trim();
    if (dto.forwardedAt) {
      const d = new Date(dto.forwardedAt);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid forwarding date.');
      data.dodForwardedAt = d;
    }
    if (dto.reference != null && String(dto.reference).trim()) data.dodReference = String(dto.reference).trim();
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to save — add the cheque photo, courier AWB or forwarding date.');
    await this.prisma.shipment.update({ where: { id: s.id }, data });
    return { ok: true, awb: s.awb, saved: Object.keys(data) };
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

  /** Re-view / reprint a cash-or-wallet counter receipt for an already-paid shipment. */
  async cashReceipt(awb: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { client: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (!s.freightCollectedAt) throw new NotFoundException(`No counter payment recorded for ${awb}.`);
    const method = String((s.client as any)?.accountType).toUpperCase() === 'WALLET' ? 'WALLET' : 'CASH';
    return {
      awb: s.awb,
      at: s.freightCollectedAt,
      sender: (s as any).shipperName ?? s.client?.legalName ?? null,
      senderGstin: (s as any).consignorGstin ?? s.client?.gstin ?? null,
      consignee: (s as any).consigneeName ?? null,
      consigneeGstin: (s as any).consigneeGstin ?? null,
      destCity: (s as any).consigneeCity ?? null,
      destPincode: (s as any).destPincode ?? null,
      product: s.product,
      deadKg: Number((s as any).totalDeadKg ?? 0),
      pieces: s.pieceCount,
      amount: (s as any).freightCollected != null ? Number((s as any).freightCollected) : null,
      method,
      customer: s.client?.legalName ?? null,
    };
  }

  /**
   * Hand-off to a vendor: record which vendor carried the shipment + the vendor/carrier AWB
   * (forwarding AWB) as a reference. Links our AWB to the carrier's — used by vendor-bill P&L
   * matching. (BlueDart auto-fetches this once the integration is live.)
   */
  async setForwarding(awb: string, dto: { vendor?: string; forwardingAwb?: string }, opts?: { isSuper?: boolean }) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, vendor: true, statusCode: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (['DLD', 'RTD'].includes(String(s.statusCode || '').toUpperCase()) && !opts?.isSuper) throw new ConflictException('Delivered — this AWB is closed and can no longer be changed. Only a super admin can correct a delivered shipment.');
    const forwardingAwb = dto.forwardingAwb ? String(dto.forwardingAwb).replace(/\s+/g, '').toUpperCase() || null : null; // "DSE 122115" breaks tracking
    // A forwarding (carrier) AWB must carry a vendor — the vendor is what drives billing network/rates.
    // Recording just the carrier AWB with a blank vendor silently bills SELF rates. Require one here
    // (either supplied now or already on the shipment) so a missed vendor can't mis-price the invoice.
    const vendor = dto.vendor ? String(dto.vendor).trim() : '';
    if (forwardingAwb && !vendor && !(s.vendor && s.vendor.trim()))
      throw new BadRequestException('Select the carrier/vendor before recording a forwarding AWB — the vendor drives billing rates (a blank vendor bills SELF-network rates).');
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
  /** Rider app "My bookings": shipments this user booked on an IST day (default today). */
  async myBookings(userId: bigint, date?: string) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const rows = await this.prisma.shipment.findMany({
      where: {
        createdById: userId, createdAt: { gte: new Date(`${d}T00:00:00+05:30`), lte: new Date(`${d}T23:59:59.999+05:30`) },
        OR: [{ statusCode: null }, { statusCode: { not: 'CAN' } }], // cancelled bookings drop off the rider's list
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        awb: true, createdAt: true, statusCode: true, vendor: true, forwardingAwb: true, bdWaybill: true, product: true,
        consigneeName: true, consigneeCity: true, destPincode: true, pieceCount: true, chargeWeight: true,
        client: { select: { accountCode: true, legalName: true } },
      },
    });
    return { date: d, rows: rows.map((r) => ({ ...r, customerCode: r.client?.accountCode, customerName: r.client?.legalName })) };
  }

  /**
   * RTO: ops mark the AWB Return-to-Origin with the carrier's RETURN number (e.g. BlueDart's new waybill).
   * Books the return leg as a normal shipment for the same customer — consignee → shipper, same boxes /
   * product / payment — under OUR AWB = original + "R" (e.g. 17605595700R), so it bills like any booking
   * (reverse-lane rate) and its tracking follows the carrier's return number. The original stays RTO while
   * the goods travel back and becomes Returned (RTD) automatically once the return AWB is delivered.
   */
  async rtoClose(awbRaw: string, dto: { returnAwb?: string; forwardingNo?: string; vendor?: string }, userId?: bigint) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s: any = await this.prisma.shipment.findUnique({ where: { awb }, include: { pieces: { orderBy: { sequenceNo: 'asc' } }, client: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (s.rtoAwb) throw new ConflictException(`RTO already closed — return AWB ${s.rtoAwb}.`);
    if (s.rtoOfAwb) throw new BadRequestException(`${awb} is itself a return of ${s.rtoOfAwb}.`);
    const cur = String(s.statusCode || 'MAN').toUpperCase();
    if (['DLD', 'CAN', 'RTD'].includes(cur)) throw new ConflictException(`${awb} is ${cur} — only an undelivered / RTO shipment can be closed as a return.`);
    const fwd = String(dto.forwardingNo || '').replace(/\s+/g, '').toUpperCase();
    if (!fwd) throw new BadRequestException('Enter the return forwarding (carrier) number.');
    const vendor = String(dto.vendor || s.vendor || '').trim();
    if (!vendor) throw new BadRequestException('Pick the carrier that is bringing it back.');
    const c = s.client ?? {};
    const pieces = (s.pieces.length ? s.pieces : [{ deadKg: s.totalDeadKg || 0.5 }]).map((p: any) => ({
      deadKg: Number(p.deadKg || 0.5), lengthCm: p.lengthCm != null ? Number(p.lengthCm) : undefined,
      widthCm: p.widthCm != null ? Number(p.widthCm) : undefined, heightCm: p.heightCm != null ? Number(p.heightCm) : undefined,
    }));
    const shipperPin = String(s.shipperPincode || c.pincode || '');
    const created: any = await this.create({
      clientId: Number(s.clientId), serviceMode: s.serviceMode, product: s.product ?? undefined, paymentTerm: s.paymentTerm ?? undefined,
      manualAwb: dto.returnAwb ? String(dto.returnAwb).trim().toUpperCase() : `${awb}R`,
      vendor, forwardingAwb: fwd,
      originZone: s.destZone, destZone: s.originZone, originPincode: s.destPincode ?? undefined, destPincode: shipperPin || undefined,
      shipperName: s.consigneeName ?? undefined, shipperCity: s.consigneeCity ?? undefined, shipperState: s.consigneeState ?? undefined,
      shipperPincode: s.destPincode ?? undefined, shipperMobile: s.consigneePhone ?? undefined, shipperGstin: s.consigneeGstin ?? undefined,
      consigneeName: s.shipperName || c.legalName, consigneeAddress: [s.shipperAddress1, s.shipperAddress2].filter(Boolean).join(', ') || c.addressLine || undefined,
      consigneeCity: s.shipperCity || c.city || undefined, consigneeState: s.shipperState || c.state || undefined,
      consigneePhone: s.shipperMobile || s.shipperContact || c.contactPhone || undefined,
      declaredValue: s.declaredValue != null ? Number(s.declaredValue) : undefined, shipmentValue: s.shipmentValue != null ? Number(s.shipmentValue) : undefined,
      goodsDesc: `RTO of ${awb}${s.goodsDesc ? ` — ${s.goodsDesc}` : ''}`.slice(0, 200), referenceNo: awb, invoiceNo: s.custInvoiceNo ?? undefined,
      deadKg: pieces.reduce((t: number, p: any) => t + p.deadKg, 0), pieces,
    } as any, { skipAutoDispatch: true });
    const retAwb = String(created?.awb ?? created?.shipment?.awb ?? '');
    if (!retAwb) throw new BadRequestException('Could not book the return AWB.');
    const now = new Date();
    const note = `RTO — returning under ${retAwb} (${vendor} ${fwd})`;
    await this.prisma.$transaction([
      // Return leg: in transit back to the shipper; carrier tracking takes it from here.
      this.prisma.shipment.update({ where: { awb: retAwb }, data: { rtoOfAwb: awb, statusCode: 'DPD', status: 'IN_TRANSIT' as any, statusAt: now, shipperAddress1: s.consigneeAddress ? String(s.consigneeAddress).slice(0, 250) : undefined } }),
      // Original: RTO until the return is delivered (then RTD automatically — closeDeliveredReturns).
      this.prisma.shipment.update({ where: { id: s.id }, data: { rtoAwb: retAwb, statusCode: 'RTO', status: 'IN_TRANSIT' as any, statusAt: now, exceptionFlag: note } }),
      ...(cur !== 'RTO' ? [this.prisma.scanLog.create({ data: { awb, eventType: 'RTO', remark: note, scannedById: userId ?? null } })] : []),
      this.prisma.scanLog.create({ data: { awb: retAwb, eventType: 'MAN', remark: `Return of ${awb}`, scannedById: userId ?? null } }),
    ]);
    return { awb, returnAwb: retAwb, forwardingNo: fwd, vendor, message: `${note}. ${retAwb} is billed on the customer's next invoice; ${awb} closes as Returned when the return is delivered.` };
  }

  /** Every 15 min: an RTO whose return AWB has been DELIVERED back to the shipper closes as Returned (RTD). */
  @Cron('*/15 * * * *')
  async closeDeliveredReturns() {
    const open = await this.prisma.shipment.findMany({ where: { rtoAwb: { not: null }, statusCode: 'RTO' }, select: { id: true, awb: true, rtoAwb: true } });
    if (!open.length) return { closed: 0 };
    const legs = await this.prisma.shipment.findMany({ where: { awb: { in: open.map((o) => o.rtoAwb as string) }, statusCode: 'DLD' }, select: { awb: true, statusAt: true } });
    const done = new Map(legs.map((l) => [l.awb, l.statusAt]));
    let closed = 0;
    for (const o of open) {
      if (!done.has(o.rtoAwb as string)) continue;
      const at = done.get(o.rtoAwb as string) ?? new Date();
      await this.prisma.$transaction([
        this.prisma.shipment.update({ where: { id: o.id }, data: { statusCode: 'RTD', status: 'DELIVERED' as any, statusAt: at, exceptionFlag: `Returned to shipper — return AWB ${o.rtoAwb} delivered` } }),
        this.prisma.scanLog.create({ data: { awb: o.awb, eventType: 'RTD', remark: `Return AWB ${o.rtoAwb} delivered to shipper`, scanAt: at } }),
      ]);
      closed++;
    }
    return { closed };
  }

  /** Attach a document (invoice copy etc.) to a shipment from the app — a data URL (image / PDF). Same store as
   *  the web's AWB Attachments; Delhivery's hand-off sends the latest invoice copy from here. A refused hand-off
   *  is re-queued so the carrier is retried with it. */
  async attachDocument(awbRaw: string, dto: { dataUrl?: string; docType?: string; label?: string }, userId?: bigint) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true, bdError: true, forwardingAwb: true, bdWaybill: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    const m = String(dto?.dataUrl || '').match(/^data:([a-z0-9.+/-]+);base64,(.+)$/i);
    if (!m) throw new BadRequestException('Attach a photo or PDF.');
    const mimeType = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new BadRequestException(`Unsupported file type ${mimeType} — PDF or photo only.`);
    const data = Buffer.from(m[2], 'base64');
    if (data.length > 12 * 1024 * 1024) throw new BadRequestException('File too large (max 12 MB).');
    const up = await this.prisma.upload.create({ data: { kind: 'document', mimeType, sizeBytes: data.length, data }, select: { id: true } });
    const doc = await this.prisma.document.create({
      data: { entityType: 'shipment', entityId: s.id, docType: dto.docType || 'invoice', label: dto.label || 'Invoice copy', uploadId: up.id, createdById: userId ?? null },
      select: { id: true, docType: true, label: true },
    });
    if (s.bdError && !s.forwardingAwb && !s.bdWaybill) await this.prisma.shipment.update({ where: { id: s.id }, data: { bdDispatchAt: null } });
    return { awb, document: { ...doc, id: String(doc.id) } };
  }

  /** A rider may edit / cancel only their own booking, still Booked (MAN). A carrier AWB the rider TYPED
   *  (DS Cargo, other manual carriers) can still be corrected; one an integration generated (BlueDart,
   *  Delhivery, XpressBees, Gati, V Express, AR) has to be cancelled with that carrier by CS first. */
  async assertRiderOwns(awbRaw: string, userId: bigint) {
    const s = await this.prisma.shipment.findUnique({ where: { awb: String(awbRaw || '').trim().toUpperCase() }, select: { createdById: true } });
    if (!s) throw new NotFoundException(`AWB ${awbRaw} not found`);
    if (s.createdById !== userId) throw new ForbiddenException('You can only attach documents to shipments you booked.');
  }

  async assertRiderCanEdit(awbRaw: string, userId: bigint) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { createdById: true, statusCode: true, bdWaybill: true, forwardingAwb: true, vendor: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (s.createdById !== userId) throw new ForbiddenException('You can only change shipments you booked. Ask CS to correct this one.');
    if (String(s.statusCode || 'MAN') !== 'MAN') throw new ConflictException('Already picked up — ask CS to correct it.');
    const apiCarrier = /^(BLUE|BDR)|^DLY|DELHIVERY|^XPB$|^XB$|XPRESS\s*BEES|^GATI$|ALLCARGO|^VXP$|^VX$|V\s*EXPRESS|^ARL$|AR\s*LOG/i.test(String(s.vendor || '').trim());
    if (s.bdWaybill || (s.forwardingAwb && apiCarrier)) throw new ConflictException('Already handed to the carrier — ask CS to cancel the carrier AWB first.');
  }

  async editShipment(awbRaw: string, dto: any, opts?: { isSuper?: boolean }) {
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { _count: { select: { invoiceLines: true } } } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    // Post-delivery lock: a DELIVERED (DLD) or RETURN-DELIVERED (RTD) AWB is closed — no further changes,
    // except a super admin correcting a genuine mistake.
    if (['DLD', 'RTD'].includes(String(s.statusCode || '').toUpperCase()) && !opts?.isSuper) throw new ConflictException('Delivered — this AWB is closed and can no longer be changed. Only a super admin can correct a delivered shipment.');
    // Invoiced shipments are locked — EXCEPT a super-admin who explicitly overrides (the edit does NOT
    // retro-change the already-raised invoice; cancel/rebill for billing changes).
    if (s._count.invoiceLines > 0 && !(opts?.isSuper && dto?.overrideInvoiced)) {
      throw new ConflictException('This AWB is already invoiced — cancel/rebill the invoice before editing.');
    }

    const data: any = {};
    // Not yet with a carrier → an edit is usually the fix for a refused hand-off: clear it so auto hand-off retries.
    if (!s.forwardingAwb && !s.bdWaybill) { data.bdError = null; data.bdDispatchAt = null; }
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
    str('shipperAddress1', dto.shipperAddress1);
    str('shipperAddress2', dto.shipperAddress2);
    str('shipperContact', dto.shipperContact);
    str('shipperCity', dto.shipperCity);
    str('referenceNo', dto.referenceNo);
    str('service', dto.service);
    upper('product', dto.product);
    upper('vendor', dto.vendor);
    if (dto.bdAccountId !== undefined) data.bdAccountId = dto.bdAccountId ? BigInt(dto.bdAccountId) : null;
    if (dto.docType !== undefined) data.docType = dto.docType || null;
    if (dto.paymentTerm !== undefined) data.paymentTerm = dto.paymentTerm;
    dec('shipmentValue', dto.shipmentValue);
    dec('declaredValue', dto.declaredValue);
    dec('chargeWeight', dto.chargeWeight);
    // E-way bill from the GST portal (clears "EWB pending"). A real EWB number is 12 digits.
    if (dto.ewbNo !== undefined) {
      const ewb = normaliseEwbNo(dto.ewbNo);
      if (ewb && !/^\d{12}$/.test(ewb)) throw new BadRequestException(`E-way bill number must be 12 digits (got "${dto.ewbNo}").`);
      data.ewbNo = ewb;
      if (!ewb) data.ewbValidUpto = null;
    }
    if (dto.ewbValidUpto !== undefined) {
      const d = String(dto.ewbValidUpto || '').trim();
      // A bare date = valid until the end of that IST day (the server runs in UTC).
      const at = d ? new Date(/T/.test(d) ? d : `${d}T23:59:59+05:30`) : null;
      if (at && isNaN(at.getTime())) throw new BadRequestException(`Invalid e-way bill validity date "${d}".`);
      data.ewbValidUpto = at;
    }
    // DOD on/off + amount, and the To-Pay freight to collect — both go to BlueDart as CollactableAmount.
    if (dto.isDod !== undefined) data.isDod = !!dto.isDod;
    if (dto.fmPickup !== undefined) data.fmPickup = dto.fmPickup === null ? null : !!dto.fmPickup;
    dec('dodAmount', dto.dodAmount);
    dec('freightToCollect', dto.freightToCollect);
    const effDod = data.isDod ?? s.isDod;
    if (effDod && !(Number(data.dodAmount !== undefined ? data.dodAmount : s.dodAmount) > 0)) {
      throw new BadRequestException('DOD is on but the DOD amount is empty — enter the cheque/DD value to collect, or switch DOD off.');
    }
    if (data.isDod === false) { data.dodAmount = null; data.dodInstrument = null; }

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
      // Recompute ODA from the NEW destination — set true OR false. (Previously only ever set true, so
      // changing an ODA pincode back to a normal one left isOda stuck on and the ODA charge stayed.)
      data.isOda = !!(destPin && (destPin.isOda || (destPin.edl && String(destPin.edl).toUpperCase() !== 'REGULAR')));
      data.expectedDelivery = await this.expectedDeliveryFor(newProduct ?? undefined, s.serviceMode, originZone, destZone, data.vendor ?? s.vendor ?? undefined);
    }

    // Dimension edits — update per-box L×B×H and recompute volumetric weight. This is a booking-time
    // correction (no debit note; that's what Re-weigh is for). dto.dimensions = [{ sequenceNo, lengthCm, widthCm, heightCm }].
    if (Array.isArray(dto.dimensions) && dto.dimensions.length) {
      const vc = await this.rates
        .volConfigFor(Number(s.clientId), String((data.product ?? s.product) ?? ''), (data.vendor ?? s.vendor) as any)
        .catch(() => ({ divisor: VOLUMETRIC_DIVISOR, cft: 0 }));
      const pieces = await this.prisma.shipmentPiece.findMany({ where: { shipmentId: s.id }, orderBy: { sequenceNo: 'asc' } });
      const bySeq = new Map<number, any>(dto.dimensions.map((d: any) => [Number(d.sequenceNo), d]));
      const num = (v: any, fb: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : fb != null ? Number(fb) : undefined);
      let totalVol = 0;
      for (const p of pieces) {
        const d = bySeq.get(p.sequenceNo);
        const L = num(d?.lengthCm, p.lengthCm);
        const W = num(d?.widthCm, p.widthCm);
        const H = num(d?.heightCm, p.heightCm);
        const vol = this.volKg(L, W, H, vc.divisor, vc.cft);
        totalVol += vol;
        if (d) {
          await this.prisma.shipmentPiece.update({
            where: { id: p.id },
            data: {
              lengthCm: L != null ? new Prisma.Decimal(L) : null,
              widthCm: W != null ? new Prisma.Decimal(W) : null,
              heightCm: H != null ? new Prisma.Decimal(H) : null,
              volKg: new Prisma.Decimal(Number(vol).toFixed(3)),
            },
          });
        }
      }
      data.totalVolKg = new Prisma.Decimal(totalVol.toFixed(3));
    }

    await this.prisma.shipment.update({ where: { id: s.id }, data });
    return { ok: true, awb, message: `${awb} updated.`, rezoned: productChanged || destChanged || originChanged };
  }

  /** Recent shipments, optionally scoped to a single client, with light rollup. */
  /** Xpresion-style AWB Entry List rows (flat, filter/grid-friendly). */
  async awbList(clientId: bigint | undefined, limit: number, search?: string, from?: string, to?: string, scope?: bigint[] | null, ewbPending?: boolean, vendors?: string[]) {
    const s = (search ?? '').trim();
    // A search matches ACROSS ALL shipments (not just the latest page) so any AWB is findable —
    // by our AWB, the carrier's forwarding/BlueDart waybill, the customer reference, or consignee.
    // #10 — staff limited to a branch/company only see those customers' shipments.
    const where: any = clientId != null ? { clientId } : scope ? { clientId: { in: scope } } : {};
    if (s) {
      where.OR = [
        { awb: { contains: s, mode: 'insensitive' } },
        { forwardingAwb: { contains: s, mode: 'insensitive' } },
        { bdWaybill: { contains: s, mode: 'insensitive' } },
        { referenceNo: { contains: s, mode: 'insensitive' } },
        { consigneeName: { contains: s, mode: 'insensitive' } },
      ];
    }
    // Booking-date range filter (bookDate = createdAt). `to` is inclusive of the whole day.
    // Whole IST days (the server runs in UTC, so a bare date used to start at 05:30 IST and end at
    // 05:29 IST the next morning — early-morning bookings fell into the wrong day).
    const gte = from ? new Date(/T/.test(from) ? from : `${from}T00:00:00+05:30`) : null;
    const lte: Date | null = to ? new Date(/T/.test(to) ? to : `${to}T23:59:59.999+05:30`) : null;
    if (gte || lte) where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    // CS worklist: ≥ ₹50k consignments still missing their e-way bill number (AND — `where.OR` is the search).
    if (ewbPending) where.AND = [EWB_PENDING_WHERE];
    // Carrier filter (Shipping Hub tile → that carrier's shipments). vendor codes, case-insensitive; SELF = none.
    if (vendors?.length) {
      const v = vendors.map((x) => x.trim()).filter(Boolean);
      const or: any[] = v.filter((x) => x.toUpperCase() !== 'SELF').map((x) => ({ vendor: { equals: x, mode: 'insensitive' } }));
      if (v.some((x) => x.toUpperCase() === 'SELF')) or.push({ vendor: null }, { vendor: { equals: 'SELF', mode: 'insensitive' } });
      where.AND = [...(where.AND ?? []), { OR: or }];
    }
    // When the caller filters (by date, search or EWB-pending) we're pulling a bounded, intentional set,
    // so lift the default 300/500 cap; otherwise keep it small for the default "latest" view.
    const filtered = !!(s || gte || lte || ewbPending || vendors?.length);
    const take = Math.min(limit || (filtered ? 10000 : 300), filtered ? 20000 : 500);
    const shipments = await this.prisma.shipment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        client: { select: { legalName: true, accountCode: true } },
        _count: { select: { invoiceLines: true } },
        pieces: { select: { lengthCm: true, widthCm: true, heightCm: true, deadKg: true }, orderBy: { sequenceNo: 'asc' } },
      },
    });
    // #3 — compact package-detail string: box dims grouped by size, e.g. "2×40x30x20, 1×55x45x30".
    const dimsOf = (pieces: { lengthCm: any; widthCm: any; heightCm: any }[]) => {
      const groups = new Map<string, number>();
      for (const p of pieces) {
        const key = [p.lengthCm, p.widthCm, p.heightCm].every((x) => x != null)
          ? `${Number(p.lengthCm)}x${Number(p.widthCm)}x${Number(p.heightCm)}` : '—';
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      return [...groups.entries()].map(([d, n]) => (n > 1 ? `${n}×${d}` : d)).join(', ');
    };
    const destPins = await pinRows(this.prisma, shipments.map((x: any) => x.destPincode));
    return shipments.map((s) => ({
      awb: s.awb,
      invoiced: s._count.invoiceLines > 0,
      bookDate: s.createdAt,
      shipperName: s.client.legalName, // client is the shipper unless a separate shipper is captured
      customerCode: s.client.accountCode,
      customerName: s.client.legalName,
      consigneeName: s.consigneeName ?? '',
      destination: placeName(s.consigneeCity, destPins.get(String(s.destPincode || '')), s.destZone),
      product: s.product ?? '',
      vendor: s.vendor ?? (s.bdWaybill ? 'BLUEDART' : 'SELF'),
      forwardingAwb: s.forwardingAwb ?? s.bdWaybill ?? null,
      actualWeight: Number(s.totalDeadKg),
      chargeWeight: s.chargeWeight != null ? Number(s.chargeWeight) : Math.max(Number(s.totalDeadKg), Number(s.totalVolKg)),
      pieces: s.pieceCount,
      dimensions: dimsOf(s.pieces), // #3 — package box dimensions (LxWxH cm), grouped by size
      shipmentValue: s.shipmentValue != null ? Number(s.shipmentValue) : (s.declaredValue != null ? Number(s.declaredValue) : null), // #6
      originPincode: s.shipperPincode ?? null, // #6
      destPincode: s.destPincode ?? null,                        // #6
      deliveryVendor: s.bdWaybill ?? s.awb, // carrier waybill; self = own AWB
      status: s.status,
      statusCode: s.statusCode ?? 'MAN', // milestone code (MAN/PKD/…/DLD/UDL/RTO) for hub filters
      bdStatus: (s as any).bdStatus ?? null,
      ewbNo: s.ewbNo ?? null,
      ewbPending: isEwbPending(s),
    }));
  }

  async list(clientId: bigint | undefined, limit: number, scope?: bigint[] | null) {
    const shipments = await this.prisma.shipment.findMany({
      where: clientId != null ? { clientId } : scope ? { clientId: { in: scope } } : undefined,
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
        shipmentValue: s.shipmentValue ?? s.declaredValue ?? null, // #6
        originPincode: s.shipperPincode ?? null,                     // #6
        destPincode: s.destPincode ?? null,                        // #6
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
      ewbPending: isEwbPending(shipment),
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

    // Volumetric config (divisor + surface CFT) so the re-weighed volumetric matches billing — SFC
    // uses CFT, not ÷5000.
    const vc = await this.rates.volConfigFor(Number(shipment.clientId), String((shipment as any).product ?? ''), (shipment as any).vendor).catch(() => ({ divisor: VOLUMETRIC_DIVISOR, cft: 0 }));

    // Apply re-weigh to each piece; build the re-weighed weight set (WITH dims so the engine can
    // recompute CFT volumetric).
    const reweighed = [] as { deadKg: number; volKg: number; lengthCm: number | null; widthCm: number | null; heightCm: number | null }[];
    for (const p of shipment.pieces) {
      const l = bySeq.get(p.sequenceNo);
      if (l) {
        const L = l.lengthCm != null ? Number(l.lengthCm) : (p.lengthCm != null ? Number(p.lengthCm) : undefined);
        const W = l.widthCm != null ? Number(l.widthCm) : (p.widthCm != null ? Number(p.widthCm) : undefined);
        const H = l.heightCm != null ? Number(l.heightCm) : (p.heightCm != null ? Number(p.heightCm) : undefined);
        const volKg = this.volKg(L, W, H, vc.divisor, vc.cft) || Number(p.volKg);
        await this.prisma.shipmentPiece.update({
          where: { id: p.id },
          data: {
            // The re-weighed figures BECOME the piece's live weight (billing + every display reads
            // deadKg/volKg), while reweighKg/reweighVolKg keep the audit that a re-weigh happened.
            deadKg: new Prisma.Decimal(l.actualKg),
            volKg: new Prisma.Decimal(volKg),
            // preserve any actual box dimensions captured during the re-weigh
            ...(l.lengthCm != null ? { lengthCm: new Prisma.Decimal(l.lengthCm) } : {}),
            ...(l.widthCm != null ? { widthCm: new Prisma.Decimal(l.widthCm) } : {}),
            ...(l.heightCm != null ? { heightCm: new Prisma.Decimal(l.heightCm) } : {}),
            reweighKg: new Prisma.Decimal(l.actualKg),
            reweighVolKg: new Prisma.Decimal(volKg),
            reweighedAt: now,
            reweighedById: reweighedById != null ? BigInt(reweighedById) : null,
          },
        });
        reweighed.push({ deadKg: l.actualKg, volKg, lengthCm: L ?? null, widthCm: W ?? null, heightCm: H ?? null });
      } else {
        reweighed.push({ deadKg: Number(p.deadKg), volKg: Number(p.volKg), lengthCm: p.lengthCm != null ? Number(p.lengthCm) : null, widthCm: p.widthCm != null ? Number(p.widthCm) : null, heightCm: p.heightCm != null ? Number(p.heightCm) : null });
      }
    }

    // #13 — boxes ADDED at re-weigh (shipment arrived with more pieces than booked). A line whose
    // sequenceNo has no matching piece becomes a new piece; sequence numbers continue after the max.
    const existingSeqs = new Set(shipment.pieces.map((p) => p.sequenceNo));
    let maxSeq = shipment.pieces.reduce((m, p) => Math.max(m, p.sequenceNo), 0);
    for (const l of lines) {
      if (existingSeqs.has(l.sequenceNo)) continue;
      maxSeq += 1;
      const seq = maxSeq;
      const volKg = this.volKg(l.lengthCm, l.widthCm, l.heightCm, vc.divisor, vc.cft) || 0;
      const childId = `${shipment.awb}-${String(seq).padStart(3, '0')}`;
      await this.prisma.shipmentPiece.create({
        data: {
          shipmentId: shipment.id, sequenceNo: seq, childId, barcodeValue: childId,
          deadKg: new Prisma.Decimal(l.actualKg), volKg: new Prisma.Decimal(volKg),
          ...(l.lengthCm != null ? { lengthCm: new Prisma.Decimal(l.lengthCm) } : {}),
          ...(l.widthCm != null ? { widthCm: new Prisma.Decimal(l.widthCm) } : {}),
          ...(l.heightCm != null ? { heightCm: new Prisma.Decimal(l.heightCm) } : {}),
          reweighKg: new Prisma.Decimal(l.actualKg), reweighVolKg: new Prisma.Decimal(volKg),
          reweighedAt: now, reweighedById: reweighedById != null ? BigInt(reweighedById) : null,
        },
      });
      reweighed.push({ deadKg: l.actualKg, volKg, lengthCm: l.lengthCm ?? null, widthCm: l.widthCm ?? null, heightCm: l.heightCm ?? null });
    }

    const newCharge = await this.rates.chargesForShipment({ ...shipment, chargeWeight: null }, reweighed as any);
    // Chargeable weight comes from the ENGINE (card-aware, CFT for surface) — not the naive ÷5000 helper.
    const bookedKg = bookedCharge?.chargeableKg ?? this.rates.chargeableKg(shipment.pieces);
    const actualKg = newCharge?.chargeableKg ?? this.rates.chargeableKg(reweighed as any);

    // Roll the re-weighed totals up onto the shipment so the list/detail/label show the new weight.
    const newTotalDead = reweighed.reduce((s, r) => s + Number(r.deadKg), 0);
    const newTotalVol = reweighed.reduce((s, r) => s + Number(r.volKg), 0);
    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        totalDeadKg: new Prisma.Decimal(newTotalDead.toFixed(3)),
        totalVolKg: new Prisma.Decimal(newTotalVol.toFixed(3)),
        chargeWeight: new Prisma.Decimal(Number(actualKg).toFixed(3)),
        pieceCount: reweighed.length, // #13 — reflect any boxes added at re-weigh
      },
    });

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
