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

  /**
   * Vendor P&L sheet reconciliation (swdev #8-5). Each sheet row is matched to our shipment by
   * forwarding no (forwardingAwb / bdWaybill / LR no), falling back to our AWB, and compared with
   * what we billed the customer on that AWB (latest invoice line). Read-only — nothing is stored.
   */
  async reconcileSheet(rows: any[]) {
    const clean = (v: any) => String(v ?? '').trim().toUpperCase();
    const fwds = [...new Set(rows.map((r) => clean(r.forwardingNo)).filter(Boolean))];
    const awbs = [...new Set(rows.map((r) => clean(r.awb)).filter(Boolean))];
    const ships = await this.prisma.shipment.findMany({
      where: { OR: [
        ...(fwds.length ? [{ forwardingAwb: { in: fwds } }, { bdWaybill: { in: fwds } }, { lrNumber: { in: fwds } }, { awb: { in: fwds } }] : []),
        ...(awbs.length ? [{ awb: { in: awbs } }] : []),
      ] },
      select: {
        id: true, awb: true, forwardingAwb: true, bdWaybill: true, lrNumber: true, vendor: true, statusCode: true,
        chargeWeight: true, totalDeadKg: true, totalVolKg: true, shipmentValue: true, declaredValue: true, destPincode: true,
        client: { select: { accountCode: true, legalName: true } },
        invoiceLines: { select: { amount: true, chargeableKg: true, breakup: true, invoice: { select: { id: true, invoiceNo: true, status: true } } } },
      },
    });
    const byFwd = new Map<string, (typeof ships)[number]>();
    const byAwb = new Map<string, (typeof ships)[number]>();
    for (const sh of ships) {
      for (const k of [sh.forwardingAwb, sh.bdWaybill, sh.lrNumber]) if (k) byFwd.set(clean(k), sh);
      byAwb.set(clean(sh.awb), sh);
    }
    const n = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : +Number(v).toFixed(2));
    const diff = (theirs: number | null, ours: number | null) => (theirs == null || ours == null ? null : +(theirs - ours).toFixed(2));
    const out = rows.map((r) => {
      const fwd = clean(r.forwardingNo), awb = clean(r.awb);
      const sh = (fwd && (byFwd.get(fwd) ?? byAwb.get(fwd))) || (awb && byAwb.get(awb)) || null;
      const sheet = { vendorCode: String(r.vendorCode ?? '').trim(), awb: String(r.awb ?? '').trim(), forwardingNo: String(r.forwardingNo ?? '').trim(),
        chargeWeight: n(r.chargeWeight), invoiceValue: n(r.invoiceValue), destPincode: String(r.destPincode ?? '').trim(), edl: n(r.edl), totalExGst: n(r.totalExGst) };
      if (!sh) return { ...sheet, matched: false, issues: ['Forwarding no not found in our system'] };
      const line = [...sh.invoiceLines].sort((a, b) => (b.invoice.id > a.invoice.id ? 1 : -1))[0];
      const bk: any = line?.breakup ?? null;
      const ours = {
        ourAwb: sh.awb, customerCode: sh.client.accountCode, customerName: sh.client.legalName, ourVendor: sh.vendor ?? '', status: sh.statusCode ?? '',
        invoiceNo: line?.invoice.invoiceNo ?? null,
        ourChargeWeight: line ? n(line.chargeableKg) : n(sh.chargeWeight ?? Math.max(Number(sh.totalDeadKg), Number(sh.totalVolKg))),
        ourInvoiceValue: n(sh.shipmentValue ?? sh.declaredValue),
        ourDestPincode: sh.destPincode ?? '',
        ourEdl: line ? n(bk?.oda ?? 0) : null,
        ourTotalExGst: line ? n(line.amount) : null,
      };
      const d = {
        diffChargeWeight: diff(sheet.chargeWeight, ours.ourChargeWeight),
        diffInvoiceValue: diff(sheet.invoiceValue, ours.ourInvoiceValue),
        diffEdl: diff(sheet.edl, ours.ourEdl),
        diffTotalExGst: diff(sheet.totalExGst, ours.ourTotalExGst),
      };
      const issues: string[] = [];
      if (!line) issues.push('Not billed yet');
      if (d.diffChargeWeight) issues.push('Charged weight');
      if (d.diffInvoiceValue) issues.push('Invoice value');
      if (sheet.destPincode && ours.ourDestPincode && sheet.destPincode !== ours.ourDestPincode) issues.push('Destination pincode');
      if (d.diffEdl) issues.push('EDL');
      if (d.diffTotalExGst) issues.push('Total sales');
      if (sheet.vendorCode && ours.ourVendor && sheet.vendorCode.toUpperCase() !== ours.ourVendor.toUpperCase()) issues.push('Vendor');
      return { ...sheet, matched: true, ...ours, ...d, issues };
    });
    return {
      count: out.length,
      matched: out.filter((x) => x.matched).length,
      withDifferences: out.filter((x) => x.issues.length).length,
      rows: out,
    };
  }
}
