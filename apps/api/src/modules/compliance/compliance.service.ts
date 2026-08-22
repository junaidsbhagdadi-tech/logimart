import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COMPANY } from '../../config/company';
import { GenerateEwayDto } from './dto/eway.dto';

const EWB_THRESHOLD = 50000; // ₹ — e-way bill required above this for inter/intra movement

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Printable Lorry Receipt / Goods Consignment Note. */
  async consignmentNote(awb: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      include: {
        client: true,
        originHub: true,
        destHub: true,
        pieces: { orderBy: { sequenceNo: 'asc' } },
      },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);

    return {
      docType: 'LORRY_RECEIPT',
      lrNumber: s.lrNumber ?? s.awb,
      awb: s.awb,
      date: s.createdAt,
      carrier: {
        name: COMPANY.legalName,
        address: COMPANY.address,
        gstin: COMPANY.gstin ?? null,
      },
      consignor: { name: s.client.legalName, gstin: s.consignorGstin ?? null },
      consignee: {
        name: s.consigneeName ?? '—',
        gstin: s.consigneeGstin ?? null,
        phone: s.consigneePhone ?? null,
      },
      route: { from: s.originHub?.name ?? s.originZone, to: s.destHub?.name ?? s.destZone, lane: `${s.originZone} -> ${s.destZone}` },
      serviceMode: s.serviceMode,
      goods: { description: s.goodsDesc ?? 'General goods', hsnCode: s.hsnCode ?? null },
      declaredValue: s.declaredValue,
      pieces: s.pieces.map((p) => ({
        childId: p.childId,
        box: `${p.sequenceNo} of ${s.pieceCount}`,
        deadKg: p.deadKg,
        volKg: p.volKg,
      })),
      totals: { pieceCount: s.pieceCount, deadKg: s.totalDeadKg, volKg: s.totalVolKg },
      eWayBill: s.ewbNo ? { number: s.ewbNo, validUpto: s.ewbValidUpto } : null,
      vehicleNo: s.vehicleNo ?? null,
    };
  }

  /**
   * Generate an e-way bill. SANDBOX: produces a simulated 12-digit EWB number and
   * validity. Wire a GST Suvidha Provider (GSP) API here for production.
   */
  async generateEwayBill(awb: string, dto: GenerateEwayDto) {
    const s = await this.prisma.shipment.findUnique({ where: { awb } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (dto.declaredValue < EWB_THRESHOLD) {
      throw new BadRequestException(
        `Declared value ₹${dto.declaredValue} is below the ₹${EWB_THRESHOLD} e-way bill threshold.`,
      );
    }

    const ewbNo = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
    const distance = dto.distanceKm ?? 100;
    const validDays = Math.max(1, Math.ceil(distance / 200)); // CGST rule of thumb
    const ewbValidUpto = new Date(Date.now() + validDays * 86400000);

    await this.prisma.shipment.update({
      where: { id: s.id },
      data: {
        declaredValue: new Prisma.Decimal(dto.declaredValue),
        vehicleNo: dto.vehicleNo,
        hsnCode: dto.hsnCode ?? s.hsnCode,
        consignorGstin: dto.consignorGstin ?? s.consignorGstin,
        consigneeGstin: dto.consigneeGstin ?? s.consigneeGstin,
        ewbNo,
        ewbValidUpto,
      },
    });

    return {
      awb,
      ewbNo,
      validUpto: ewbValidUpto,
      distanceKm: distance,
      declaredValue: dto.declaredValue,
      mode: 'SANDBOX',
      note: 'Simulated EWB. Configure a GSP (e.g. ClearTax/Masters India) for live generation.',
    };
  }
}
