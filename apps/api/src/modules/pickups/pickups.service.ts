import { Injectable, NotFoundException } from '@nestjs/common';
import { PickupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface CreatePickup {
  clientId: number;
  pickupAddress: string;
  city?: string;
  pincode?: string;
  contactName?: string;
  contactPhone?: string;
  estPieces?: number;
  cargoMode?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  invoiceValue?: number;
  ewbNo?: string;
  notes?: string;
}

@Injectable()
export class PickupsService {
  constructor(private readonly prisma: PrismaService) {}

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
        invoiceNo: dto.invoiceNo,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
        invoiceValue: dto.invoiceValue != null ? new Prisma.Decimal(dto.invoiceValue) : null,
        ewbNo: dto.ewbNo,
        notes: dto.notes,
      },
    });
  }

  /** Client admins see only their own requests; ops staff see all. */
  list(clientId?: bigint) {
    return this.prisma.pickupRequest.findMany({
      where: clientId != null ? { clientId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async assign(id: number, riderId: number) {
    await this.exists(id);
    return this.prisma.pickupRequest.update({
      where: { id: BigInt(id) },
      data: { assignedRiderId: BigInt(riderId), status: PickupStatus.ASSIGNED },
    });
  }

  async complete(id: number) {
    await this.exists(id);
    return this.prisma.pickupRequest.update({
      where: { id: BigInt(id) },
      data: { status: PickupStatus.PICKED },
    });
  }

  private async exists(id: number) {
    const p = await this.prisma.pickupRequest.findUnique({ where: { id: BigInt(id) } });
    if (!p) throw new NotFoundException('Pickup request not found');
    return p;
  }
}
