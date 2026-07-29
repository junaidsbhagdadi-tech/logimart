import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COMPANY } from '../../config/company';

/**
 * Builds one thermal label per child box for a master AWB.
 * Returns both a structured JSON payload (for the portal/preview) and raw ZPL
 * (for direct spooling to Zebra printers, 4x6 @ 203dpi).
 */
@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async buildForAwb(awb: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { awb },
      include: { pieces: { orderBy: { sequenceNo: 'asc' } }, client: true },
    });
    if (!shipment) throw new NotFoundException(`AWB ${awb} not found`);

    const client = shipment.client;
    const master = {
      awb: shipment.awb,
      barcode: shipment.awb,
      lrNumber: shipment.lrNumber ?? shipment.awb,
      carrier: { brand: COMPANY.brand, tagline: COMPANY.tagline },
      consignor: {
        name: client.legalName,
        address: [client.addressLine, client.city, client.pincode].filter(Boolean).join(', ') || '—',
        gstin: shipment.consignorGstin ?? client.gstin ?? null,
      },
      consignee: {
        name: shipment.consigneeName ?? '—',
        address: [shipment.consigneeAddress, shipment.consigneeCity, shipment.destPincode].filter(Boolean).join(', ') || '—',
        phone: shipment.consigneePhone ?? null,
        gstin: shipment.consigneeGstin ?? null,
      },
      serviceMode: shipment.serviceMode,
      route: `${shipment.originZone} → ${shipment.destZone}`,
      pieceCount: shipment.pieceCount,
      totalDeadKg: Number(shipment.totalDeadKg),
      totalVolKg: Number(shipment.totalVolKg),
      declaredValue: shipment.declaredValue ? Number(shipment.declaredValue) : null,
      goodsDesc: shipment.goodsDesc ?? null,
      ewbNo: shipment.ewbNo ?? null,
    };

    const labels = shipment.pieces.map((p) => {
      const json = {
        company: COMPANY.brand,
        masterAwb: shipment.awb,
        childId: p.childId,
        sequenceLabel: `Box ${p.sequenceNo} of ${shipment.pieceCount}`,
        barcode: p.barcodeValue,
        deadKg: Number(p.deadKg),
        volKg: Number(p.volKg),
        serviceMode: shipment.serviceMode,
        route: `${shipment.originZone} -> ${shipment.destZone}`,
        client: shipment.client.legalName,
      };
      return { ...json, zpl: this.toZpl(json, shipment.pieceCount) };
    });

    return { awb: shipment.awb, pieceCount: shipment.pieceCount, master, labels };
  }

  /** Minimal 4x6 ZPL: header, child barcode, sequence, weights. */
  private toZpl(d: any, pieceCount: number): string {
    return [
      '^XA',
      '^CF0,30',
      `^FO30,30^FD${COMPANY.brand} — ${COMPANY.tagline}^FS`,
      '^CF0,40',
      `^FO30,75^FDAWB: ${d.masterAwb}^FS`,
      `^FO30,120^FDBox ${d.sequenceLabel.replace('Box ', '')}^FS`,
      // Code128 of the child id
      `^FO30,170^BY3^BCN,120,Y,N,N^FD${d.barcode}^FS`,
      // QR of the child id (right side)
      `^FO470,170^BQN,2,5^FDLA,${d.barcode}^FS`,
      '^CF0,28',
      `^FO30,330^FDDead: ${d.deadKg} kg   Vol: ${d.volKg} kg^FS`,
      `^FO30,370^FDMode: ${d.serviceMode}   ${d.route}^FS`,
      `^FO30,410^FDClient: ${d.client}^FS`,
      '^XZ',
    ].join('\n');
  }
}
