import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FuelService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current price in force + recent history. */
  async current(fuelType = 'DIESEL') {
    const [latest, history] = await Promise.all([
      this.prisma.fuelPrice.findFirst({ where: { fuelType }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.fuelPrice.findMany({ where: { fuelType }, orderBy: { effectiveFrom: 'desc' }, take: 12 }),
    ]);
    return { fuelType, current: latest ? Number(latest.price) : null, effectiveFrom: latest?.effectiveFrom ?? null, history };
  }

  setPrice(dto: { price: number; fuelType?: string; effectiveFrom?: string; note?: string }) {
    return this.prisma.fuelPrice.create({
      data: {
        fuelType: dto.fuelType || 'DIESEL',
        price: new Prisma.Decimal(dto.price),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
        note: dto.note || null,
      },
    });
  }
}
