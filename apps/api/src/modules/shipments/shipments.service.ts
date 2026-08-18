import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  /** LMT + YYYY + zero-padded sequence, e.g. LMT2026000045. */
  private async nextAwb(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.shipment.count();
    const seq = String(count + 1).padStart(6, '0');
    return `${COMPANY.awbPrefix}${year}${seq}`;
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

    const awb = await this.nextAwb();
    const total = dto.pieces.length;

    // Pincode → region drives the billing zone; directory flags ODA destinations.
    const originZone = (dto.originPincode && regionFromPincode(dto.originPincode)) || dto.originZone;
    const destZone = (dto.destPincode && regionFromPincode(dto.destPincode)) || dto.destZone;
    let isOda = dto.isOda ?? false;
    if (dto.destPincode) {
      const pin = await this.prisma.pincode.findUnique({ where: { pincode: dto.destPincode } });
      if (pin?.isOda) isOda = true;
    }

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

    return this.prisma.shipment.create({
      data: {
        awb,
        lrNumber,
        clientId: BigInt(dto.clientId),
        serviceMode: dto.serviceMode,
        originHubId: BigInt(dto.originHubId),
        destHubId: BigInt(dto.destHubId),
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

  /** Recent shipments, optionally scoped to a single client, with light rollup. */
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
      },
    });
    if (!shipment) throw new NotFoundException(`AWB ${awb} not found`);

    const delivered = shipment.pieces.filter((p) => p.status === 'DELIVERED').length;
    return {
      ...shipment,
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
