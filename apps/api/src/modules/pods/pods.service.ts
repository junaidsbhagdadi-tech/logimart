import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PieceStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { CreatePodDto } from './dto/create-pod.dto';

@Injectable()
export class PodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Record Proof of Delivery. GPS is mandatory (DTO-enforced).
   * If fewer pieces are delivered than the AWB carries, the POD is BLOCKED
   * (409 with a missing-piece warning) unless ?force=true, which records a
   * short delivery and flags the shipment PARTIAL.
   */
  async createPod(awb: string, dto: CreatePodDto, deliveredById: bigint, force: boolean) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { awb },
      include: { pieces: { select: { status: true } } },
    });
    if (!shipment) throw new NotFoundException(`AWB ${awb} not found`);

    // DOD gate: a Draft-on-Delivery shipment cannot be delivered until the
    // cheque/DD has been collected from the consignee.
    if (shipment.isDod && !shipment.dodCollectedAt) {
      throw new ConflictException({
        message: `DOD not collected — delivery blocked. Collect the ${shipment.dodInstrument ?? 'cheque/DD'} (₹${shipment.dodAmount ?? '—'}) before recording POD.`,
        awb,
        dodAmount: shipment.dodAmount,
        dodInstrument: shipment.dodInstrument,
      });
    }

    const isShort = dto.piecesDelivered < shipment.pieceCount;
    if (isShort && !force) {
      throw new ConflictException({
        message: 'Missing pieces — POD blocked. Boxes are unaccounted for.',
        expected: shipment.pieceCount,
        deliveredNow: dto.piecesDelivered,
        hint: 'Resolve the missing boxes, or resend with ?force=true to record a short delivery.',
      });
    }

    // Offload signature / stamp images to Spaces (keys), inline fallback when unconfigured.
    const [signatureUrl, stampPhotoUrl] = await Promise.all([
      this.storage.store(dto.signatureUrl, 'sig'),
      this.storage.store(dto.stampPhotoUrl, 'stamp'),
    ]);
    const pod = await this.prisma.pod.create({
      data: {
        shipmentId: shipment.id,
        deliveredById,
        gpsLat: new Prisma.Decimal(dto.gpsLat),
        gpsLng: new Prisma.Decimal(dto.gpsLng),
        signatureUrl,
        stampPhotoUrl,
        piecesDelivered: dto.piecesDelivered,
        isShort,
        deliveredAt: new Date(),
      },
    });

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: isShort ? ShipmentStatus.PARTIAL : ShipmentStatus.DELIVERED },
    });

    // Mark the delivered pieces DELIVERED so billing (which bills delivered pieces) picks them up.
    if (isShort) {
      const ps = await this.prisma.shipmentPiece.findMany({
        where: { shipmentId: shipment.id }, orderBy: { sequenceNo: 'asc' }, select: { id: true },
      });
      const ids = ps.slice(0, dto.piecesDelivered).map((p) => p.id);
      if (ids.length) await this.prisma.shipmentPiece.updateMany({ where: { id: { in: ids } }, data: { status: PieceStatus.DELIVERED } });
    } else {
      await this.prisma.shipmentPiece.updateMany({ where: { shipmentId: shipment.id }, data: { status: PieceStatus.DELIVERED } });
    }

    await this.notifications.notify({
      channel: shipment.consigneePhone ? 'whatsapp' : 'inapp',
      recipient: shipment.consigneePhone ?? 'ops',
      kind: isShort ? 'shortage' : 'delivery',
      awb,
      shipmentId: shipment.id,
      message: isShort
        ? `SHORT delivery on ${awb}: ${dto.piecesDelivered}/${shipment.pieceCount} boxes delivered.`
        : `${awb} delivered in full (${dto.piecesDelivered} boxes). POD captured.`,
    });

    return { pod, isShort, expected: shipment.pieceCount };
  }

  /**
   * #23b — Attach (or replace) a POD image on an AWB from the tracking page, without running the full
   * delivery sign-off. Stores the image and sets shipment.podUrl. Does not change status.
   */
  async attachPodImage(awb: string, dataUrl: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb: String(awb).trim().toUpperCase() }, select: { id: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (!dataUrl) throw new ConflictException('No image provided.');
    const stored = await this.storage.store(dataUrl, 'pod');
    await this.prisma.shipment.update({ where: { id: s.id }, data: { podUrl: stored } });
    return { ok: true, awb };
  }
}
