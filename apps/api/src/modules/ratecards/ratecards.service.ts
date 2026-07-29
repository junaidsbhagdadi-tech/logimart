import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRateCardDto } from './dto/ratecard.dto';

const dec = (n?: number) => new Prisma.Decimal(n ?? 0);

@Injectable()
export class RateCardsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateRateCardDto) {
    return this.prisma.rateCard.create({
      data: {
        clientId: BigInt(dto.clientId),
        originZone: dto.originZone,
        destZone: dto.destZone,
        serviceMode: dto.serviceMode,
        perKgRate: dec(dto.perKgRate),
        minCharge: dec(dto.minCharge),
        fuelPct: dec(dto.fuelPct),
        fovPct: dec(dto.fovPct),
        fovMin: dec(dto.fovMin),
        odaFlat: dec(dto.odaFlat),
        odaPerKg: dec(dto.odaPerKg),
        odaMin: dec(dto.odaMin),
        docketCharge: dec(dto.docketCharge),
        handlingCharge: dec(dto.handlingCharge),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      },
    });
  }

  list(clientId?: number) {
    return this.prisma.rateCard.findMany({
      where: clientId != null ? { clientId: BigInt(clientId) } : undefined,
      orderBy: [{ clientId: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  // ---- FTL rates (per vehicle type / trip) ----
  createFtl(dto: {
    clientId?: number; originZone: string; destZone: string; vehicleType: string;
    flatRate: number; fuelPct?: number; effectiveFrom?: string;
  }) {
    return this.prisma.ftlRate.create({
      data: {
        clientId: dto.clientId != null ? BigInt(dto.clientId) : null,
        originZone: dto.originZone,
        destZone: dto.destZone,
        vehicleType: dto.vehicleType,
        flatRate: dec(dto.flatRate),
        fuelPct: dec(dto.fuelPct),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      },
    });
  }

  listFtl() {
    return this.prisma.ftlRate.findMany({ orderBy: [{ clientId: 'asc' }, { effectiveFrom: 'desc' }] });
  }
}
