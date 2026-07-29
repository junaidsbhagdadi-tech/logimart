import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ManifestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: { vehicleNo: string; fromHubId: number; toHubId: number; driverId?: number }) {
    const code = `MAN${Date.now().toString().slice(-8)}`;
    return this.prisma.manifest.create({
      data: {
        code,
        vehicleNo: dto.vehicleNo,
        fromHubId: BigInt(dto.fromHubId),
        toHubId: BigInt(dto.toHubId),
        driverId: dto.driverId != null ? BigInt(dto.driverId) : null,
      },
    });
  }

  list() {
    return this.prisma.manifest.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async get(id: number) {
    const m = await this.prisma.manifest.findUnique({ where: { id: BigInt(id) } });
    if (!m) throw new NotFoundException('Manifest not found');
    const shipments = await this.prisma.shipment.findMany({
      where: { manifestId: m.id },
      select: { awb: true, status: true, pieceCount: true },
    });
    return { ...m, shipments };
  }

  /** Attach consignments (by AWB) to the manifest. */
  async attach(id: number, awbs: string[]) {
    const m = await this.prisma.manifest.findUnique({ where: { id: BigInt(id) } });
    if (!m) throw new NotFoundException('Manifest not found');
    if (m.status !== 'open') throw new BadRequestException('Manifest is not open');
    await this.prisma.shipment.updateMany({
      where: { awb: { in: awbs } },
      data: { manifestId: m.id },
    });
    return this.get(id);
  }

  /**
   * Seal the manifest: every piece of every attached consignment must be LOADED.
   * Blocks (409) and lists the offenders otherwise (manifest validation, Module 2).
   */
  async seal(id: number) {
    const m = await this.prisma.manifest.findUnique({ where: { id: BigInt(id) } });
    if (!m) throw new NotFoundException('Manifest not found');

    const shipments = await this.prisma.shipment.findMany({
      where: { manifestId: m.id },
      include: { pieces: { select: { childId: true, status: true } } },
    });
    if (shipments.length === 0) throw new BadRequestException('No consignments attached');

    const notLoaded = shipments.flatMap((s) =>
      s.pieces.filter((p) => p.status !== 'LOADED' && p.status !== 'DELIVERED').map((p) => p.childId),
    );
    if (notLoaded.length > 0) {
      throw new ConflictException({
        message: 'Cannot seal — these boxes are not yet loaded.',
        notLoaded,
      });
    }

    await this.prisma.manifest.update({ where: { id: m.id }, data: { status: 'sealed' } });
    return this.get(id);
  }

  async arrive(id: number) {
    const m = await this.prisma.manifest.findUnique({ where: { id: BigInt(id) } });
    if (!m) throw new NotFoundException('Manifest not found');
    await this.prisma.manifest.update({ where: { id: m.id }, data: { status: 'arrived' } });
    return this.get(id);
  }
}
