import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePodDto } from './dto/create-pod.dto';

@Injectable()
export class PodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
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

    const pod = await this.prisma.pod.create({
      data: {
        shipmentId: shipment.id,
        deliveredById,
        gpsLat: new Prisma.Decimal(dto.gpsLat),
        gpsLng: new Prisma.Decimal(dto.gpsLng),
        signatureUrl: dto.signatureUrl,
        stampPhotoUrl: dto.stampPhotoUrl,
        piecesDelivered: dto.piecesDelivered,
        isShort,
        deliveredAt: new Date(),
      },
    });

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: isShort ? ShipmentStatus.PARTIAL : ShipmentStatus.DELIVERED },
    });

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
}
