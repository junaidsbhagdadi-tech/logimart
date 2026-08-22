import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
    for (const code of [`${net}__${mode}`, `SELF__${mode}`, mode]) {
      const entry = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'ZONE_TAT', code } } });
      const days = Number((entry?.attrs as any)?.matrix?.[orig]?.[dest]);
      if (days > 0) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; }
    }
    return null;
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
  async create(dto: CreateShipmentDto) {
    // ---- Credit control gate: block booking for inactive / over-limit accounts ----
    const client = await this.prisma.b2bClient.findUnique({
      where: { id: BigInt(dto.clientId) },
      select: { isActive: true, isCreditHold: true, legalName: true, outstandingBal: true, creditLimit: true },
    });
    if (!client) throw new NotFoundException('Client not found');
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
    const awb = manualAwb || (await this.nextAwb());
    const total = dto.pieces.length;

    // Product-specific zone from the pincode master (DP→dpZone, APEX→apexZone,
    // SURFACE→surfaceZone), falling back to broad region then the supplied zone.
    const [originPin, destPin] = await Promise.all([
      dto.originPincode ? this.prisma.pincode.findUnique({ where: { pincode: dto.originPincode } }) : null,
      dto.destPincode ? this.prisma.pincode.findUnique({ where: { pincode: dto.destPincode } }) : null,
    ]);
    const zoneFor = (pin: any, pincode?: string, fallback?: string): string | undefined => {
      const fam = String(dto.product ?? '').toUpperCase();
      const isSurface = ['SURFACE', 'SFC', 'HUB'].includes(fam) || /ROAD|RAIL|SURFACE/i.test(String(dto.serviceMode ?? ''));
      const zRaw = pin && (['DP', 'TDD', 'NDD'].includes(fam) ? pin.dpZone : fam === 'APEX' ? pin.apexZone : isSurface ? pin.surfaceZone : pin.ecomZone);
      const z = zRaw ? String(zRaw).replace(/\s+/g, '').toUpperCase() : zRaw; // "NE 1" -> "NE1"
      return z || pin?.region || (pincode ? regionFromPincode(pincode) : undefined) || fallback;
    };
    const originZone = zoneFor(originPin, dto.originPincode, dto.originZone) || dto.originZone;
    const destZone = zoneFor(destPin, dto.destPincode, dto.destZone) || dto.destZone;
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
