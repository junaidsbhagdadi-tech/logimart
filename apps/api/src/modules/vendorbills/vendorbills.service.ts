import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const dec = (v: any) => new Prisma.Decimal(v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : 0);
const numOrNull = (v: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null);
const str = (v: any) => (v == null ? null : String(v).trim() || null);

@Injectable()
export class VendorBillsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bulk upsert vendor bill rows (from the vendor bill upload), keyed by vendorCode+awb. */
  async bulkUpsert(rows: any[]) {
    let ok = 0;
    const errors: { awb: string; error: string }[] = [];
    for (const r of rows) {
      const awb = String(r.awb ?? '').trim();
      const vendorCode = String(r.vendorCode ?? '').trim();
      if (!awb || !vendorCode) { errors.push({ awb: awb || '(blank)', error: 'vendorCode + awb required' }); continue; }
      const data = {
        product: str(r.product), productType: str(r.productType), forwardingNo: str(r.forwardingNo),
        pickupDate: r.pickupDate ? new Date(r.pickupDate) : null,
        origin: str(r.origin), destination: str(r.destination),
        actWeight: numOrNull(r.actWeight) != null ? dec(r.actWeight) : null, chrgWeight: numOrNull(r.chrgWeight) != null ? dec(r.chrgWeight) : null,
        pcs: numOrNull(r.pcs), freight: dec(r.freight), fs: dec(r.fs), caf: dec(r.caf), awbCharge: dec(r.awbCharge),
        greenTax: dec(r.greenTax), edl: dec(r.edl), fov: dec(r.fov), tdd: dec(r.tdd), topay: dec(r.topay),
        total: dec(r.total), totalWithGst: dec(r.totalWithGst), destPincode: str(r.destPincode),
        declaredValue: numOrNull(r.declaredValue) != null ? dec(r.declaredValue) : null,
      };
      try {
        await this.prisma.vendorBill.upsert({ where: { vendorCode_awb: { vendorCode, awb } }, update: data, create: { vendorCode, awb, ...data } });
        ok++;
      } catch (e: any) { errors.push({ awb, error: e.message }); }
    }
    return { imported: ok, failed: errors.length, errors: errors.slice(0, 50) };
  }

  list(vendorCode?: string, awb?: string) {
    return this.prisma.vendorBill.findMany({
      where: { ...(vendorCode ? { vendorCode } : {}), ...(awb ? { awb } : {}) },
      orderBy: { createdAt: 'desc' }, take: 2000,
    });
  }
}
