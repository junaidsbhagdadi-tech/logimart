import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';

/**
 * Customer-facing external API — authenticated by the customer's `x-api-key` (see ApiKeyGuard),
 * scoped to that customer's own shipments. Read-only for now (ping / list / track); external
 * booking can be added once the customer confirms they want it.
 */
@Controller('api/ext/v1')
@UseGuards(ApiKeyGuard)
export class ExternalController {
  constructor(private readonly prisma: PrismaService, private readonly tracking: TrackingService) {}

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
}
