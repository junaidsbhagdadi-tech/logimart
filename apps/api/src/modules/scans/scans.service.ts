import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BulkSyncDto } from './dto/bulk-sync.dto';
import { projectPieceStatus } from './projector';

export interface BulkResult {
  accepted: string[];
  duplicate: string[];
  rejected: { clientEventId: string; reason: string }[];
}

@Injectable()
export class ScansService {
  private readonly logger = new Logger(ScansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Ingest a batch of offline scans.
   * - Idempotent on clientEventId (UNIQUE): replays are reported as duplicates.
   * - Unknown barcodes are rejected (device keeps & retries / surfaces).
   * - After persisting, re-projects the affected pieces and rolls up the AWB.
   */
  async bulkSync(dto: BulkSyncDto, scannedById: bigint): Promise<BulkResult> {
    const result: BulkResult = { accepted: [], duplicate: [], rejected: [] };

    // resolve barcodes -> piece ids in one query
    const barcodes = [...new Set(dto.events.map((e) => e.barcode))];
    const pieces = await this.prisma.shipmentPiece.findMany({
      where: { barcodeValue: { in: barcodes } },
      select: { id: true, barcodeValue: true, shipmentId: true },
    });
    const pieceByBarcode = new Map(pieces.map((p) => [p.barcodeValue, p]));

    const touchedPieceIds = new Set<bigint>();

    for (const e of dto.events) {
      const piece = pieceByBarcode.get(e.barcode);
      if (!piece) {
        result.rejected.push({ clientEventId: e.clientEventId, reason: 'unknown_barcode' });
        continue;
      }
      try {
        await this.prisma.scanEvent.create({
          data: {
            clientEventId: e.clientEventId,
            pieceId: piece.id,
            checkpoint: e.checkpoint,
            scannedById,
            hubId: e.hubId != null ? BigInt(e.hubId) : null,
            scannedAt: new Date(e.scannedAt),
            deviceSeq: e.deviceSeq != null ? BigInt(e.deviceSeq) : null,
            gpsLat: e.gps ? new Prisma.Decimal(e.gps.lat) : null,
            gpsLng: e.gps ? new Prisma.Decimal(e.gps.lng) : null,
            meta: { deviceId: dto.deviceId },
          },
        });
        result.accepted.push(e.clientEventId);
        touchedPieceIds.add(piece.id);
      } catch (err) {
        // Unique violation on clientEventId => safe replay
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          result.duplicate.push(e.clientEventId);
        } else {
          this.logger.error(`scan ingest failed for ${e.clientEventId}`, err as Error);
          result.rejected.push({ clientEventId: e.clientEventId, reason: 'internal_error' });
        }
      }
    }

    await this.reproject([...touchedPieceIds]);
    return result;
  }

  /** Recompute piece status from full event log, then roll the AWB up. */
  private async reproject(pieceIds: bigint[]) {
    const affectedShipments = new Set<bigint>();

    for (const pieceId of pieceIds) {
      const events = await this.prisma.scanEvent.findMany({
        where: { pieceId },
        select: { checkpoint: true, scannedAt: true, deviceSeq: true, hubId: true },
      });
      const { status, anomaly } = projectPieceStatus(events);
      const piece = await this.prisma.shipmentPiece.update({
        where: { id: pieceId },
        data: { status },
        select: { shipmentId: true },
      });
      affectedShipments.add(piece.shipmentId);
      if (anomaly) {
        await this.prisma.shipment.update({
          where: { id: piece.shipmentId },
          data: { status: ShipmentStatus.EXCEPTION, exceptionFlag: anomaly },
        });
      }
    }

    for (const shipmentId of affectedShipments) {
      await this.rollupShipment(shipmentId);
    }
  }

  /**
   * Derive master AWB status from its pieces.
   * Cannot go IN_TRANSIT until ALL pieces are LOADED. Shortage -> PARTIAL.
   */
  private async rollupShipment(shipmentId: bigint) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { pieces: { select: { status: true } } },
    });
    if (!shipment) return;
    if (shipment.status === ShipmentStatus.EXCEPTION) return; // sticky until cleared

    const total = shipment.pieceCount;
    const n = (s: string) => shipment.pieces.filter((p) => p.status === s).length;

    let next: ShipmentStatus = shipment.status;
    if (n('DELIVERED') === total) next = ShipmentStatus.DELIVERED;
    else if (n('DELIVERED') > 0) next = ShipmentStatus.PARTIAL; // shortage flag
    else if (n('OUT_FOR_DELIVERY') > 0) next = ShipmentStatus.OUT_FOR_DELIVERY;
    else if (n('LOADED') === total) next = ShipmentStatus.IN_TRANSIT;
    else if (n('AT_HUB') > 0) next = ShipmentStatus.AT_HUB;
    else if (n('PICKED_UP') > 0) next = ShipmentStatus.PICKED_UP;

    if (next !== shipment.status) {
      await this.prisma.shipment.update({ where: { id: shipmentId }, data: { status: next } });
      // Module 1: automated shortage alert to sender when a bundle goes partial.
      if (next === ShipmentStatus.PARTIAL) {
        await this.notifications.notify({
          channel: shipment.consigneePhone ? 'whatsapp' : 'inapp',
          recipient: shipment.consigneePhone ?? 'ops',
          kind: 'shortage',
          awb: shipment.awb,
          shipmentId,
          message: `Shortage on ${shipment.awb}: only ${n('DELIVERED')}/${total} boxes delivered.`,
        });
      } else {
        await this.milestoneAlert(shipment.awb, shipmentId, next, shipment.consigneePhone);
      }
    }
  }

  /** Consignee-facing milestone alerts on each forward status change. */
  private readonly MILESTONE_MSG: Partial<Record<ShipmentStatus, string>> = {
    [ShipmentStatus.PICKED_UP]: 'has been picked up',
    [ShipmentStatus.IN_TRANSIT]: 'is now in transit',
    [ShipmentStatus.AT_HUB]: 'has reached the hub',
    [ShipmentStatus.OUT_FOR_DELIVERY]: 'is out for delivery today',
    [ShipmentStatus.DELIVERED]: 'has been delivered',
  };

  async milestoneAlert(awb: string, shipmentId: bigint, status: ShipmentStatus, consigneePhone?: string | null) {
    const phrase = this.MILESTONE_MSG[status];
    if (!phrase) return;
    await this.notifications.notify({
      channel: consigneePhone ? 'whatsapp' : 'inapp',
      recipient: consigneePhone ?? 'ops',
      kind: 'milestone',
      awb,
      shipmentId,
      message: `Your shipment ${awb} ${phrase}.`,
    });
  }
}
