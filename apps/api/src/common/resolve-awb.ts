import { PrismaService } from '../prisma/prisma.service';

/**
 * Turn whatever was scanned into OUR AWB: our AWB itself, a box id (L…-001), or a carrier's number —
 * forwarding no / LR, BlueDart waybill, our LR no, or a carrier box id (Delhivery / XpressBees child
 * waybill printed on their box label). Returns null when nothing matches.
 */
export async function resolveScannedAwb(prisma: PrismaService, raw: string): Promise<string | null> {
  const v = String(raw || '').trim().toUpperCase();
  if (!v) return null;
  const own = await prisma.shipment.findUnique({ where: { awb: v }, select: { awb: true } });
  if (own) return own.awb;
  const piece = await prisma.shipmentPiece.findFirst({
    where: { OR: [{ childId: v }, { carrierChildId: v }] },
    select: { shipment: { select: { awb: true } } },
  });
  if (piece?.shipment) return piece.shipment.awb;
  const alt = await prisma.shipment.findFirst({
    where: { OR: [{ forwardingAwb: { equals: v, mode: 'insensitive' } }, { bdWaybill: v }, { lrNumber: { equals: v, mode: 'insensitive' } }] },
    orderBy: { createdAt: 'desc' }, select: { awb: true },
  });
  return alt?.awb ?? null;
}
