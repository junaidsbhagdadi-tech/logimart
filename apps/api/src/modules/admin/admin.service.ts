import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Purge ONE customer's test/transactional data (shipments + children, invoices/ledger,
   * rate cards/slabs, per-customer billing config), FK-safe. Keeps the customer record
   * itself (balance reset). Scoped — never touches other customers.
   */
  async clearClient(clientId: number) {
    const p = this.prisma;
    const cid = BigInt(clientId);
    const client = await p.b2bClient.findUnique({ where: { id: cid }, select: { legalName: true, accountCode: true } });
    if (!client) throw new NotFoundException('Client not found');

    const shipments = await p.shipment.findMany({ where: { clientId: cid }, select: { id: true, awb: true } });
    const sIds = shipments.map((s) => s.id);
    const awbs = shipments.map((s) => s.awb);
    const pieces = await p.shipmentPiece.findMany({ where: { shipmentId: { in: sIds } }, select: { id: true } });
    const pieceIds = pieces.map((x) => x.id);
    const invoices = await p.invoice.findMany({ where: { clientId: cid }, select: { id: true } });
    const invIds = invoices.map((i) => i.id);

    const r: Record<string, number> = {};
    const del = async (k: string, fn: () => Promise<{ count: number }>) => { r[k] = (await fn()).count; };

    await del('scanEvents', () => p.scanEvent.deleteMany({ where: { pieceId: { in: pieceIds } } }));
    await del('scanLogs', () => p.scanLog.deleteMany({ where: { awb: { in: awbs } } }));
    await del('pods', () => p.pod.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('invoiceLines', () => p.invoiceLineItem.deleteMany({ where: { OR: [{ shipmentId: { in: sIds } }, { invoiceId: { in: invIds } }] } }));
    await del('ledger', () => p.ledgerEntry.deleteMany({ where: { clientId: cid } }));
    await del('debitCreditNotes', () => p.debitCreditNote.deleteMany({ where: { clientId: cid } }));
    await del('claims', () => p.claim.deleteMany({ where: { clientId: cid } }));
    await del('invoices', () => p.invoice.deleteMany({ where: { clientId: cid } }));
    await del('shipmentPieces', () => p.shipmentPiece.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('shipments', () => p.shipment.deleteMany({ where: { clientId: cid } }));
    await del('pickups', () => p.pickupRequest.deleteMany({ where: { clientId: cid } }));
    await del('customerRateCards', () => p.customerRateCard.deleteMany({ where: { clientId: cid } })); // slabs cascade
    await del('rateSlabs', () => p.clientRateSlab.deleteMany({ where: { clientId: cid } }));
    await del('customerFuel', () => p.customerFuelSurcharge.deleteMany({ where: { clientId: cid } }));
    await del('customerCharges', () => p.customerOtherCharge.deleteMany({ where: { clientId: cid } }));
    await del('customerVolumetric', () => p.customerVolumetric.deleteMany({ where: { clientId: cid } }));

    await p.b2bClient.update({ where: { id: cid }, data: { outstandingBal: 0, isCreditHold: false } });

    return { ok: true, client: client.accountCode + ' — ' + client.legalName, totalDeleted: Object.values(r).reduce((s, n) => s + n, 0), cleared: r };
  }

  /**
   * Clear test/transactional data for a clean UAT slate. Keeps users, hubs, customers,
   * vendors, rate cards, and reference masters — wipes shipments + all their children,
   * invoices/ledger/notes/claims, the per-customer billing config, serviceability/service
   * maps, fuel prices, and the demo test customer/vendor. Deleted in FK-safe order.
   */
  async clearTestData() {
    const p = this.prisma;
    const r: Record<string, number> = {};
    const del = async (k: string, fn: () => Promise<{ count: number }>) => { r[k] = (await fn()).count; };

    await del('scanLogs', () => p.scanLog.deleteMany({}));
    await del('scanEvents', () => p.scanEvent.deleteMany({}));
    await del('pods', () => p.pod.deleteMany({}));
    await del('invoiceLines', () => p.invoiceLineItem.deleteMany({}));
    await del('ledger', () => p.ledgerEntry.deleteMany({}));
    await del('debitCreditNotes', () => p.debitCreditNote.deleteMany({}));
    await del('claims', () => p.claim.deleteMany({}));
    await del('invoices', () => p.invoice.deleteMany({}));
    await del('shipmentPieces', () => p.shipmentPiece.deleteMany({}));
    await del('shipments', () => p.shipment.deleteMany({}));
    await del('manifests', () => p.manifest.deleteMany({}));
    await del('pickups', () => p.pickupRequest.deleteMany({}));

    await del('rateSlabs', () => p.clientRateSlab.deleteMany({}));
    await del('customerFuel', () => p.customerFuelSurcharge.deleteMany({}));
    await del('customerCharges', () => p.customerOtherCharge.deleteMany({}));
    await del('customerVolumetric', () => p.customerVolumetric.deleteMany({}));
    await del('customerAddresses', () => p.customerAddress.deleteMany({}));
    // Serviceability: keep the loaded carrier product coverage (BLUEDART-*), drop only the
    // stray verification rows (SELF, bare BLUEDART) so real data survives.
    await del('strayServiceAreas', () => p.serviceablePincode.deleteMany({ where: { NOT: { network: { startsWith: 'BLUEDART-' } } } }));
    await del('serviceMappings', () => p.serviceMapping.deleteMany({}));
    await del('fuelPrices', () => p.fuelPrice.deleteMany({}));
    await del('integrationTokens', () => p.integrationToken.deleteMany({}));
    await del('fuelMechanisms', () => p.masterEntry.deleteMany({ where: { type: 'FUEL_MECHANISM' } }));

    await del('vendorPayments', () => p.vendorPayment.deleteMany({}));
    await del('testVendors', () => p.vendor.deleteMany({ where: { vendorCode: 'BLR-BD' } }));

    // reset the AWB counter (re-seeds on next booking) and customers' running balances
    await del('awbCounter', () => p.counter.deleteMany({ where: { name: 'awb' } }));
    await p.b2bClient.updateMany({ data: { outstandingBal: 0, isCreditHold: false } });

    const total = Object.values(r).reduce((s, n) => s + n, 0);
    return {
      ok: true,
      totalDeleted: total,
      cleared: r,
      kept: ['users', 'hubs', 'customers (balances reset)', 'vendors', 'rate cards', 'reference masters', 'BLUEDART-* serviceability'],
    };
  }
}
