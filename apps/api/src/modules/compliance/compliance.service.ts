import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COMPANY } from '../../config/company';
import { EWB_THRESHOLD } from '../shipments/ewb';
import { GenerateEwayDto } from './dto/eway.dto';

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
   * E-way bill generation is NOT wired to a GST Suvidha Provider (GSP), so we refuse rather than store
   * a simulated number (it used to write a random 12-digit "EWB" onto the shipment — a GST compliance
   * risk, since it prints on AWB copies / manifests and goes to carriers). Generate it on the GST portal
   * and record it via Edit AWB. Wire a GSP (e.g. ClearTax / Masters India) here for live generation.
   */
  async generateEwayBill(awb: string, dto: GenerateEwayDto) {
    const s = await this.prisma.shipment.findUnique({ where: { awb }, select: { id: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (dto.declaredValue < EWB_THRESHOLD) {
      throw new BadRequestException(
        `Declared value ₹${dto.declaredValue} is below the ₹${EWB_THRESHOLD} e-way bill threshold.`,
      );
    }
    throw new BadRequestException(
      'Live e-way bill generation is not connected. Generate the e-way bill on the GST portal (ewaybillgst.gov.in) and enter its number on Edit AWB.',
    );
  }
}
