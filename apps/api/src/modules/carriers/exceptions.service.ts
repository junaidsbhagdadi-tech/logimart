import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { scopedClientIds } from '../../common/scope/data-scope';

/**
 * CS exceptions inbox — one to-do list instead of hunting across pages. Each bucket lists what needs a
 * person, newest problems first, limited to recent work (stale bulk-upload history is excluded).
 */
const DAY = 864e5;

@Injectable()
export class ExceptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async inbox(user: any) {
    const scope = await scopedClientIds(this.prisma, user);
    const cw: any = scope ? { clientId: { in: scope } } : {};
    const now = Date.now();
    const recent = new Date(now - 30 * DAY);
    const sel = {
      awb: true, createdAt: true, vendor: true, statusCode: true, statusAt: true, consigneeName: true, consigneeCity: true, destPincode: true,
      forwardingAwb: true, bdWaybill: true, bdError: true, bdStatus: true, exceptionFlag: true, declaredValue: true, ewbNo: true,
      client: { select: { accountCode: true, legalName: true } },
    } as const;
    const open = { OR: [{ statusCode: null }, { statusCode: { notIn: ['DLD', 'RTD', 'CAN'] } }] };

    const [handoffFailed, awaitingHandoff, undelivered, rto, stuck, ewbPending, invoicesUnsent, pickupsWaiting] = await Promise.all([
      // Carrier refused the hand-off (missing mobile / invoice copy / pincode …) — fix and retry.
      this.prisma.shipment.findMany({ where: { ...cw, createdAt: { gte: recent }, bdError: { not: null }, forwardingAwb: null, bdWaybill: null, AND: [open] }, select: sel, orderBy: { bdDispatchAt: 'desc' }, take: 300 }),
      // Booked in the ERP on an API carrier > 2 h ago and still not with the carrier.
      this.prisma.shipment.findMany({ where: { ...cw, createdById: { not: null }, createdAt: { gte: new Date(now - 7 * DAY), lt: new Date(now - 2 * 3600_000) }, bdError: null, forwardingAwb: null, bdWaybill: null, bdPickupToken: null, vendor: { not: null }, OR: [{ statusCode: null }, { statusCode: 'MAN' }] }, select: sel, orderBy: { createdAt: 'asc' }, take: 300 }),
      this.prisma.shipment.findMany({ where: { ...cw, statusCode: 'UDL', statusAt: { gte: recent } }, select: sel, orderBy: { statusAt: 'desc' }, take: 300 }),
      this.prisma.shipment.findMany({ where: { ...cw, statusCode: 'RTO', statusAt: { gte: recent } }, select: sel, orderBy: { statusAt: 'desc' }, take: 300 }),
      // With a carrier, recent, but no movement for 3+ days.
      this.prisma.shipment.findMany({
        where: { ...cw, createdAt: { gte: recent }, statusCode: { in: ['PKD', 'ORD', 'DPD', 'DRD', 'OFD'] }, OR: [{ statusAt: { lt: new Date(now - 3 * DAY) } }, { statusAt: null }] },
        select: sel, orderBy: { statusAt: 'asc' }, take: 300,
      }),
      this.prisma.shipment.findMany({ where: { ...cw, createdAt: { gte: recent }, declaredValue: { gte: 50000 }, OR: [{ ewbNo: null }, { ewbNo: '' }], AND: [open] }, select: sel, orderBy: { createdAt: 'desc' }, take: 300 }),
      this.prisma.invoice.findMany({
        where: { ...(scope ? { clientId: { in: scope } } : {}), status: { not: 'DRAFT' }, sentAt: null },
        select: { id: true, invoiceNo: true, total: true, issuedAt: true, client: { select: { accountCode: true, legalName: true } } }, orderBy: { issuedAt: 'asc' }, take: 300,
      }),
      this.prisma.pickupRequest.findMany({
        where: { ...cw, status: 'REQUESTED', createdAt: { lt: new Date(now - 2 * 3600_000), gte: recent } },
        select: { id: true, createdAt: true, pickupAddress: true, city: true, pincode: true, contactName: true, vendor: true, clientId: true }, orderBy: { createdAt: 'asc' }, take: 300,
      }),
    ]);

    const ageDays = (d?: Date | null) => (d ? Math.floor((now - new Date(d).getTime()) / DAY) : null);
    const ship = (s: any, reason: string) => ({
      awb: s.awb, customer: s.client ? `${s.client.accountCode} — ${s.client.legalName}` : '', vendor: s.vendor || 'SELF',
      carrierAwb: s.bdWaybill || s.forwardingAwb || null, status: s.statusCode || 'MAN', consignee: s.consigneeName || '',
      destination: s.consigneeCity || s.destPincode || '', reason, ageDays: ageDays(s.statusAt || s.createdAt), bookedAt: s.createdAt,
    });
    const pickupClients = pickupsWaiting.length ? await this.prisma.b2bClient.findMany({ where: { id: { in: [...new Set(pickupsWaiting.map((p) => p.clientId))] } }, select: { id: true, accountCode: true, legalName: true } }) : [];

    const buckets = [
      { key: 'handoff_failed', title: 'Carrier hand-off failed', hint: 'Fix the AWB (Edit AWB / attach invoice) and retry the hand-off.', items: handoffFailed.map((s) => ship(s, String(s.bdError))) },
      { key: 'awaiting_handoff', title: 'Not yet with the carrier', hint: 'Booked over 2 hours ago with no carrier AWB.', items: awaitingHandoff.map((s) => ship(s, `Booked ${ageDays(s.createdAt)}d ago, no carrier AWB`)) },
      { key: 'undelivered', title: 'Undelivered', hint: 'Call the consignee / reschedule with the carrier.', items: undelivered.map((s) => ship(s, s.exceptionFlag || s.bdStatus || 'Undelivered')) },
      { key: 'rto', title: 'Return to origin', hint: 'Inform the customer; track the return.', items: rto.map((s) => ship(s, s.exceptionFlag || s.bdStatus || 'RTO')) },
      { key: 'stuck', title: 'No movement for 3+ days', hint: 'Chase the carrier.', items: stuck.map((s) => ship(s, s.bdStatus || `Last update ${ageDays(s.statusAt)}d ago`)) },
      { key: 'ewb_pending', title: 'E-way bill pending (₹50,000+)', hint: 'Get the e-way bill number and add it via Edit AWB.', items: ewbPending.map((s) => ship(s, `Value ₹${Number(s.declaredValue).toLocaleString('en-IN')} — no e-way bill`)) },
      { key: 'invoices_unsent', title: 'Invoices issued but not sent', hint: 'Customers only see an invoice after it is sent.', items: invoicesUnsent.map((i) => ({ invoiceId: String(i.id), invoiceNo: i.invoiceNo, customer: i.client ? `${i.client.accountCode} — ${i.client.legalName}` : '', total: Number(i.total), ageDays: ageDays(i.issuedAt), reason: 'Not sent to the customer' })) },
      { key: 'pickups_waiting', title: 'Pickup requests not actioned', hint: 'Assign a rider or hand off to a carrier.', items: pickupsWaiting.map((p) => { const c = pickupClients.find((x) => x.id === p.clientId); return { pickupId: String(p.id), customer: c ? `${c.accountCode} — ${c.legalName}` : '', address: [p.pickupAddress, p.city, p.pincode].filter(Boolean).join(', '), vendor: p.vendor || '', ageDays: ageDays(p.createdAt), reason: `Waiting ${Math.round((now - p.createdAt.getTime()) / 3600_000)} h` }; }) },
    ];
    return { generatedAt: new Date(), total: buckets.reduce((a, b) => a + b.items.length, 0), buckets };
  }
}
