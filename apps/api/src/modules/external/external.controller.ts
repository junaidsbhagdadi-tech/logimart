import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { ShipmentsService } from '../shipments/shipments.service';

// Surface products ride ROAD_PTL; everything else is air express (same split the booking screens use).
const SURFACE = new Set(['SFC', 'TOSFC', 'HUB', 'DOD', 'XSE', 'FOD', 'TRAIN']);
const PIN = /^\d{6}$/;

/**
 * Customer-facing external API — authenticated by the customer's `x-api-key` (see ApiKeyGuard),
 * scoped to that customer's own shipments: ping / list / track / book / cancel.
 * Public reference: /developers on the ERP.
 */
@Controller('api/ext/v1')
@UseGuards(ApiKeyGuard)
export class ExternalController {
  constructor(private readonly prisma: PrismaService, private readonly tracking: TrackingService, private readonly shipSvc: ShipmentsService) {}

  private cid(req: any): bigint { return req.apiClient.clientId; }

  /** Key check — returns the customer the key belongs to. */
  @Get('ping')
  async ping(@Req() req: any) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: this.cid(req) }, select: { legalName: true, accountCode: true } });
    return { ok: true, customer: c?.legalName ?? null, accountCode: c?.accountCode ?? null };
  }

  /** List the customer's shipments (newest first). Optional ?search= (AWB / fwd / ref / consignee), ?limit=. */
  @Get('shipments')
  async shipments(@Req() req: any, @Query('limit') limit?: string, @Query('search') search?: string) {
    const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const s = String(search || '').trim();
    const where: any = { clientId: this.cid(req) };
    if (s) where.OR = [
      { awb: { contains: s, mode: 'insensitive' } },
      { forwardingAwb: { contains: s, mode: 'insensitive' } },
      { referenceNo: { contains: s, mode: 'insensitive' } },
      { consigneeName: { contains: s, mode: 'insensitive' } },
    ];
    const rows = await this.prisma.shipment.findMany({
      where, orderBy: { createdAt: 'desc' }, take,
      select: { awb: true, createdAt: true, statusCode: true, product: true, consigneeName: true, consigneeCity: true, destPincode: true, forwardingAwb: true, vendor: true, pieceCount: true, totalDeadKg: true },
    });
    return {
      count: rows.length,
      shipments: rows.map((r: any) => ({
        awb: r.awb, bookedAt: r.createdAt, status: r.statusCode, product: r.product,
        consignee: r.consigneeName, destCity: r.consigneeCity, destPincode: r.destPincode,
        forwardingAwb: r.forwardingAwb, vendor: r.vendor, pieces: r.pieceCount, deadKg: Number(r.totalDeadKg),
      })),
    };
  }

  /** Track one of the customer's shipments by AWB / forwarding no / reference. */
  @Get('track/:awb')
  async track(@Req() req: any, @Param('awb') awb: string) {
    const key = String(awb).trim();
    const own = await this.prisma.shipment.findFirst({
      where: {
        clientId: this.cid(req),
        OR: [
          { awb: { equals: key, mode: 'insensitive' } },
          { forwardingAwb: { equals: key, mode: 'insensitive' } },
          { referenceNo: { equals: key, mode: 'insensitive' } },
          { lrNumber: { equals: key, mode: 'insensitive' } },
        ],
      },
      select: { awb: true },
    });
    if (!own) throw new NotFoundException('Shipment not found for your account.');
    return this.tracking.track(own.awb);
  }

  /**
   * Book a shipment under the key's account. Body (JSON):
   * { referenceNo?, product (SFC/APEX/DP/…), paymentTerm? (PREPAID|TO_PAY), freightToCollect?,
   *   shipper: { name, phone?, address1, address2?, pincode, city?, gstin? },
   *   consignee: { name, phone, address, pincode, city?, gstin? },
   *   invoice: { no?, value, ewbNo? }, goodsDesc?, appointmentDelivery?,
   *   pieces: [{ weightKg, lengthCm?, widthCm?, heightCm? }] }
   */
  @Post('shipments')
  async book(@Req() req: any, @Body() b: any) {
    const bad = (m: string) => { throw new BadRequestException(m); };
    const sh = b?.shipper ?? {}, cn = b?.consignee ?? {}, inv = b?.invoice ?? {};
    const product = String(b?.product ?? '').trim().toUpperCase() || bad('product is required (e.g. SFC, APEX, DP).');
    const pieces: any[] = Array.isArray(b?.pieces) ? b.pieces : [];
    if (!pieces.length || pieces.length > 500) bad('pieces must list 1–500 boxes, each with weightKg.');
    if (pieces.some((p) => !(Number(p?.weightKg) > 0))) bad('every piece needs weightKg > 0.');
    for (const [k, v] of [['shipper.name', sh.name], ['shipper.address1', sh.address1], ['consignee.name', cn.name], ['consignee.phone', cn.phone], ['consignee.address', cn.address]] as const)
      if (!String(v ?? '').trim()) bad(`${k} is required.`);
    const oPin = String(sh.pincode ?? '').trim(), dPin = String(cn.pincode ?? '').trim();
    if (!PIN.test(oPin)) bad('shipper.pincode must be a 6-digit pincode.');
    if (!PIN.test(dPin)) bad('consignee.pincode must be a 6-digit pincode.');
    if (!(await this.prisma.pincode.findUnique({ where: { pincode: oPin }, select: { pincode: true } }))) bad(`Pickup pincode ${oPin} is not serviceable.`);
    const value = Number(inv.value);
    if (!(value > 0)) bad('invoice.value (goods value in INR) is required.');
    const term = String(b?.paymentTerm ?? 'PREPAID').toUpperCase();
    if (!['PREPAID', 'TO_PAY'].includes(term)) bad('paymentTerm must be PREPAID or TO_PAY.');
    const ref = String(b?.referenceNo ?? '').trim() || undefined;
    if (ref) {
      const dup = await this.prisma.shipment.findFirst({ where: { clientId: this.cid(req), referenceNo: ref, NOT: { statusCode: 'CAN' } }, select: { awb: true } });
      if (dup) bad(`referenceNo ${ref} is already booked as AWB ${dup.awb}.`);
    }
    const s = await this.shipSvc.create({
      clientId: Number(this.cid(req)),
      product, serviceMode: (SURFACE.has(product) ? 'ROAD_PTL' : 'AIR_EXPRESS') as any,
      originZone: '', destZone: '', originPincode: oPin, destPincode: dPin,
      shipperName: String(sh.name).trim(), shipperPhone: sh.phone ? String(sh.phone) : undefined,
      shipperAddress1: String(sh.address1).trim(), shipperAddress2: sh.address2 ? String(sh.address2) : undefined,
      shipperPincode: oPin, shipperCity: sh.city ? String(sh.city) : undefined, shipperGstin: sh.gstin ? String(sh.gstin) : undefined,
      consigneeName: String(cn.name).trim(), consigneePhone: String(cn.phone), consigneeAddress: String(cn.address).trim(),
      consigneeCity: cn.city ? String(cn.city) : undefined, consigneeGstin: cn.gstin ? String(cn.gstin) : undefined,
      declaredValue: value, shipmentValue: value, invoiceNo: inv.no ? String(inv.no) : undefined, ewbNo: inv.ewbNo ? String(inv.ewbNo) : undefined,
      goodsDesc: b?.goodsDesc ? String(b.goodsDesc) : undefined, referenceNo: ref,
      apptDelivery: !!b?.appointmentDelivery,
      paymentTerm: term as any, freightToCollect: term === 'TO_PAY' && Number(b?.freightToCollect) > 0 ? Number(b.freightToCollect) : undefined,
      pieces: pieces.map((p) => ({ deadKg: Number(p.weightKg), lengthCm: p.lengthCm != null ? Number(p.lengthCm) : undefined, widthCm: p.widthCm != null ? Number(p.widthCm) : undefined, heightCm: p.heightCm != null ? Number(p.heightCm) : undefined })),
    } as any, {});
    const x: any = s;
    return { awb: x.awb, referenceNo: x.referenceNo ?? null, product: x.product, pieces: x.pieceCount, expectedDelivery: x.expectedDelivery ?? null, status: x.statusCode ?? 'MAN', trackUrl: `https://erp.logimart.co.in/track/${x.awb}` };
  }

  /** Cancel a shipment that hasn't moved yet (booked / picked up only). */
  @Post('shipments/:awb/cancel')
  async cancel(@Req() req: any, @Param('awb') awb: string, @Body() b: any) {
    return this.shipSvc.cancel(awb, undefined, Number(this.cid(req)), String(b?.reason ?? 'Cancelled via API'));
  }
}
