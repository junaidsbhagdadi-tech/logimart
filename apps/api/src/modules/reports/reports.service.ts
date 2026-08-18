import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type Report = { columns: { key: string; label: string }[]; rows: any[] };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async run(type: string, from?: string, to?: string): Promise<Report> {
    const gte = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const lte = to ? new Date(new Date(to).getTime() + 86400000) : new Date();
    const range = { gte, lte };
    switch (type.toUpperCase()) {
      case 'MIS': return this.mis(range);
      case 'DAILY': return this.daily(range);
      case 'CUSTOMER_SUMMARY': return this.customerSummary(range);
      case 'PRODUCT_SUMMARY': return this.productSummary(range);
      case 'DESTINATION_SUMMARY': return this.destinationSummary(range);
      case 'DELIVERY_STATUS': return this.deliveryStatus(range);
      case 'SCAN': return this.scanReport(range);
      case 'RECEIVABLES': return this.receivables();
      case 'INVOICE': return this.invoiceReport();
      case 'VENDOR': return this.vendorReport();
      case 'MANIFEST': return this.manifestReport(range);
      case 'PICKUP': return this.pickupReport(range);
      default: return { columns: [{ key: 'msg', label: 'Info' }], rows: [{ msg: `Report '${type}' is not implemented yet.` }] };
    }
  }

  private async mis(range: any): Promise<Report> {
    const total = await this.prisma.shipment.count({ where: { createdAt: range } });
    const byStatus = await this.prisma.shipment.groupBy({ by: ['status'], where: { createdAt: range }, _count: { _all: true } });
    const m = Object.fromEntries(byStatus.map((x) => [x.status, x._count._all]));
    const rows = [
      { metric: 'Shipments booked', value: total },
      { metric: 'Delivered', value: m['DELIVERED'] || 0 },
      { metric: 'In transit / at hub / OFD', value: (m['IN_TRANSIT'] || 0) + (m['AT_HUB'] || 0) + (m['OUT_FOR_DELIVERY'] || 0) },
      { metric: 'Exceptions', value: m['EXCEPTION'] || 0 },
      { metric: 'Created (not yet moved)', value: m['CREATED'] || 0 },
    ];
    return { columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }], rows };
  }

  private async daily(range: any): Promise<Report> {
    const s = await this.prisma.shipment.findMany({ where: { createdAt: range }, select: { createdAt: true, totalDeadKg: true } });
    const m = new Map<string, { count: number; kg: number }>();
    for (const x of s) {
      const d = x.createdAt.toISOString().slice(0, 10);
      const e = m.get(d) || { count: 0, kg: 0 };
      e.count++; e.kg += Number(x.totalDeadKg);
      m.set(d, e);
    }
    const rows = [...m.entries()].sort().map(([date, v]) => ({ date, shipments: v.count, deadKg: v.kg.toFixed(2) }));
    return { columns: [{ key: 'date', label: 'Date' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async customerSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['clientId'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const clients = await this.prisma.b2bClient.findMany({ select: { id: true, legalName: true } });
    const nm = new Map(clients.map((c) => [c.id.toString(), c.legalName]));
    const rows = g
      .map((x) => ({ customer: nm.get(x.clientId.toString()) || x.clientId.toString(), shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'customer', label: 'Customer' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async productSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['product'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const rows = g
      .map((x) => ({ product: x.product || '—', shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'product', label: 'Product' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async destinationSummary(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['destZone'], where: { createdAt: range }, _count: { _all: true }, _sum: { totalDeadKg: true } });
    const rows = g
      .map((x) => ({ destination: x.destZone || '—', shipments: x._count._all, deadKg: Number(x._sum.totalDeadKg || 0).toFixed(2) }))
      .sort((a, b) => b.shipments - a.shipments);
    return { columns: [{ key: 'destination', label: 'Destination zone' }, { key: 'shipments', label: 'Shipments' }, { key: 'deadKg', label: 'Dead kg' }], rows };
  }

  private async deliveryStatus(range: any): Promise<Report> {
    const g = await this.prisma.shipment.groupBy({ by: ['status'], where: { createdAt: range }, _count: { _all: true } });
    const rows = g.map((x) => ({ status: x.status, count: x._count._all })).sort((a, b) => b.count - a.count);
    return { columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Count' }], rows };
  }

  private async scanReport(range: any): Promise<Report> {
    const s = await this.prisma.scanLog.findMany({ where: { scanAt: range }, orderBy: { scanAt: 'desc' }, take: 1000 });
    const rows = s.map((x) => ({ awb: x.awb, event: x.eventType, serviceCenter: x.serviceCenter || '—', at: x.scanAt.toISOString().replace('T', ' ').slice(0, 19) }));
    return { columns: [{ key: 'awb', label: 'AWB' }, { key: 'event', label: 'Event' }, { key: 'serviceCenter', label: 'Service centre' }, { key: 'at', label: 'At' }], rows };
  }

  private async invoiceReport(): Promise<Report> {
    const inv = await this.prisma.invoice.findMany({
      include: { client: { select: { legalName: true } } },
      orderBy: { id: 'desc' },
      take: 500,
    });
    const rows = inv.map((x) => ({ invoiceNo: x.invoiceNo, customer: x.client.legalName, total: Number(x.total).toFixed(2), status: x.status, dueDate: x.dueDate.toISOString().slice(0, 10) }));
    return { columns: [{ key: 'invoiceNo', label: 'Invoice No' }, { key: 'customer', label: 'Customer' }, { key: 'total', label: 'Total ₹' }, { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due date' }], rows };
  }

  private async vendorReport(): Promise<Report> {
    const v = await this.prisma.vendor.findMany({ orderBy: { name: 'asc' } });
    const rows = v.map((x) => ({ name: x.name, modes: x.modes, city: x.city || '—', gstin: x.gstin || '—', active: x.isActive ? 'Yes' : 'No' }));
    return { columns: [{ key: 'name', label: 'Vendor' }, { key: 'modes', label: 'Modes' }, { key: 'city', label: 'City' }, { key: 'gstin', label: 'GSTIN' }, { key: 'active', label: 'Active' }], rows };
  }

  private async manifestReport(range: any): Promise<Report> {
    const m = await this.prisma.manifest.findMany({ where: { createdAt: range }, orderBy: { id: 'desc' }, take: 500 });
    const rows = m.map((x) => ({ code: x.code, vehicleNo: x.vehicleNo, status: x.status, at: x.createdAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'code', label: 'Manifest' }, { key: 'vehicleNo', label: 'Vehicle' }, { key: 'status', label: 'Status' }, { key: 'at', label: 'Created' }], rows };
  }

  private async pickupReport(range: any): Promise<Report> {
    const p = await this.prisma.pickupRequest.findMany({ where: { createdAt: range }, orderBy: { id: 'desc' }, take: 500 });
    const rows = p.map((x) => ({ address: x.pickupAddress, city: x.city || '—', pieces: x.estPieces, mode: x.cargoMode || '—', at: x.createdAt.toISOString().slice(0, 16).replace('T', ' ') }));
    return { columns: [{ key: 'address', label: 'Pickup address' }, { key: 'city', label: 'City' }, { key: 'pieces', label: 'Est. pieces' }, { key: 'mode', label: 'Mode' }, { key: 'at', label: 'Created' }], rows };
  }

  private async receivables(): Promise<Report> {
    const c = await this.prisma.b2bClient.findMany({ where: { outstandingBal: { gt: 0 } }, select: { legalName: true, outstandingBal: true, creditLimit: true, creditDays: true, isCreditHold: true } });
    const rows = c
      .map((x) => ({ customer: x.legalName, outstanding: Number(x.outstandingBal).toFixed(2), creditLimit: Number(x.creditLimit).toFixed(2), creditDays: x.creditDays, hold: x.isCreditHold ? 'YES' : '' }))
      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    return { columns: [{ key: 'customer', label: 'Customer' }, { key: 'outstanding', label: 'Outstanding ₹' }, { key: 'creditLimit', label: 'Credit limit ₹' }, { key: 'creditDays', label: 'Credit days' }, { key: 'hold', label: 'Hold' }], rows };
  }
}
