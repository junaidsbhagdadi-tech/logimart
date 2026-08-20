import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
