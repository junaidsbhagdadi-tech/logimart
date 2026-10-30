import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const dec = (v: any) => new Prisma.Decimal(v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : 0);
const numOrNull = (v: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null);
const str = (v: any) => (v == null ? null : String(v).trim() || null);

@Injectable()
export class VendorBillsService {
  constructor(private readonly prisma: PrismaService) {}

  // ===================== uploaded AWB-level bill files: vendor × upload date =====================

  /** Uploaded vendor-bill rows grouped vendor-wise and upload-date-wise (IST) — what a "file" was. */
  async uploads() {
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT "vendorCode" AS vendor, to_char(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS rows, COALESCE(sum("totalWithGst"), 0)::float AS total,
             min("pickupDate") AS "firstPickup", max("pickupDate") AS "lastPickup"
      FROM vendor_bills GROUP BY 1, 2 ORDER BY 2 DESC, 1`;
    return rows;
  }

  /** Delete one vendor's uploaded rows — all of them, or only those uploaded on `day` (YYYY-MM-DD, IST). */
  async deleteUploads(vendorCode: string, day?: string) {
    const v = String(vendorCode || '').trim();
    if (!v) throw new BadRequestException('Pick the vendor.');
    const where: Prisma.VendorBillWhereInput = { vendorCode: v };
    if (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequestException('Date must be YYYY-MM-DD.');
      where.createdAt = { gte: new Date(`${day}T00:00:00+05:30`), lte: new Date(`${day}T23:59:59.999+05:30`) };
    }
    const r = await this.prisma.vendorBill.deleteMany({ where });
    return { ok: true, deleted: r.count };
  }

  // ===================== vendor bill REGISTER (the vendors' invoices to us) + payments =====================

  private day(v: any, field: string, required = false): Date | null {
    const s = String(v ?? '').trim();
    if (!s) { if (required) throw new BadRequestException(`${field} is required.`); return null; }
    const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    const d = new Date(m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10));
    if (isNaN(+d)) throw new BadRequestException(`${field}: bad date "${s}".`);
    return d;
  }

  async listInvoices(f: { vendorCode?: string; from?: string; to?: string; status?: string }) {
    const where: Prisma.VendorInvoiceWhereInput = {};
    if (f.vendorCode) where.vendorCode = f.vendorCode;
    if (f.status) where.status = f.status === 'UNPAID' ? { in: ['OPEN', 'PARTIAL'] } : f.status;
    if (f.from || f.to) where.invoiceDate = { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) };
    const rows = await this.prisma.vendorInvoice.findMany({
      where, orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }], take: 2000,
      include: { allocations: { include: { payment: { select: { id: true, paidOn: true, mode: true, reference: true } } } } },
    });
    const vendors = await this.prisma.vendor.findMany({ where: { vendorCode: { in: [...new Set(rows.map((r) => r.vendorCode))] } }, select: { vendorCode: true, name: true } });
    const vname = new Map(vendors.map((v) => [v.vendorCode, v.name]));
    return rows.map(({ allocations, ...r }) => ({
      ...r, id: String(r.id), vendorName: vname.get(r.vendorCode) ?? null, balance: +(Number(r.grandTotal) - Number(r.settled)).toFixed(2),
      payments: allocations.map((a) => ({ paymentId: String(a.paymentId), amount: Number(a.amount), paidOn: a.payment.paidOn, mode: a.payment.mode, reference: a.payment.reference })),
    }));
  }

  async createInvoice(dto: any, userId?: bigint) {
    const vendorCode = String(dto?.vendorCode ?? '').trim();
    const invoiceNo = String(dto?.invoiceNo ?? '').trim();
    if (!vendorCode) throw new BadRequestException('Vendor code is required.');
    if (!invoiceNo) throw new BadRequestException('Vendor invoice no is required.');
    const amount = Number(dto?.amount) || 0, gst = Number(dto?.gst) || 0;
    const grandTotal = dto?.grandTotal != null && dto.grandTotal !== '' ? Number(dto.grandTotal) : amount + gst;
    if (!(grandTotal > 0)) throw new BadRequestException('Enter the bill amount.');
    try {
      const r = await this.prisma.vendorInvoice.create({
        data: {
          vendorCode, invoiceNo, location: str(dto.location), notes: str(dto.notes),
          periodFrom: this.day(dto.periodFrom, 'Period from'), periodTo: this.day(dto.periodTo, 'Period to'),
          invoiceDate: this.day(dto.invoiceDate, 'Invoice date', true)!, dueDate: this.day(dto.dueDate, 'Due date'),
          amount: dec(amount), gst: dec(gst), grandTotal: dec(grandTotal), createdById: userId ?? null,
        },
      });
      return { ...r, id: String(r.id) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException(`Invoice ${invoiceNo} of ${vendorCode} is already recorded.`);
      throw e;
    }
  }

  async deleteInvoice(id: number) {
    const inv = await this.prisma.vendorInvoice.findUnique({ where: { id: BigInt(id) }, include: { _count: { select: { allocations: true } } } });
    if (!inv) throw new NotFoundException('Vendor invoice not found');
    if (inv._count.allocations) throw new BadRequestException('A payment is recorded against this invoice — delete that payment first.');
    await this.prisma.vendorInvoice.delete({ where: { id: inv.id } });
    return { ok: true };
  }

  /**
   * One payment settles several invoices of ONE vendor: cash paid + TDS + other deductions are spread
   * over the selected invoices oldest-due first (each up to its balance). Also posted to the vendor's
   * payment ledger so the TDS shows on the 26Q.
   */
  async recordPayment(dto: any, userId?: bigint) {
    const ids = [...new Set<string>((dto?.invoiceIds ?? []).map((x: any) => String(x)))];
    if (!ids.length) throw new BadRequestException('Select the invoices this payment settles.');
    const invs = await this.prisma.vendorInvoice.findMany({ where: { id: { in: ids.map((x) => BigInt(x)) } }, orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }] });
    if (invs.length !== ids.length) throw new NotFoundException('Some selected invoices no longer exist — refresh.');
    const vendors = [...new Set(invs.map((i) => i.vendorCode))];
    if (vendors.length > 1) throw new BadRequestException(`One payment is for one vendor — selected: ${vendors.join(', ')}.`);
    const amount = Number(dto?.amount) || 0, tds = Number(dto?.tds) || 0, other = Number(dto?.other) || 0;
    let pool = +(amount + tds + other).toFixed(2);
    if (!(pool > 0)) throw new BadRequestException('Enter the amount paid (and any TDS / deduction).');
    const paidOn = this.day(dto?.paidOn, 'Payment date') ?? new Date();
    const plan: { inv: (typeof invs)[number]; take: number }[] = [];
    for (const inv of invs) {
      const bal = +(Number(inv.grandTotal) - Number(inv.settled)).toFixed(2);
      if (bal <= 0 || pool <= 0) continue;
      const take = Math.min(bal, pool);
      plan.push({ inv, take }); pool = +(pool - take).toFixed(2);
    }
    if (!plan.length) throw new BadRequestException('The selected invoices are already fully paid.');
    const pay = await this.prisma.$transaction(async (tx) => {
      const p = await tx.vendorBillPayment.create({
        data: { vendorCode: vendors[0], paidOn, amount: dec(amount), tds: dec(tds), other: dec(other), otherNote: str(dto?.otherNote), mode: str(dto?.mode), reference: str(dto?.reference), createdById: userId ?? null },
      });
      for (const { inv, take } of plan) {
        await tx.vendorPaymentAllocation.create({ data: { paymentId: p.id, invoiceId: inv.id, amount: dec(take) } });
        const settled = +(Number(inv.settled) + take).toFixed(2);
        await tx.vendorInvoice.update({ where: { id: inv.id }, data: { settled: dec(settled), status: settled >= Number(inv.grandTotal) - 0.01 ? 'PAID' : 'PARTIAL' } });
      }
      return p;
    });
    // Vendor payment ledger (TDS 26Q) — best effort; the register stays the source for this screen.
    const nos = plan.map((x) => x.inv.invoiceNo).join(', ');
    const v = await this.prisma.vendor.findFirst({ where: { vendorCode: vendors[0] }, select: { id: true } });
    if (v) {
      await this.prisma.vendorPayment.create({
        data: { vendorId: v.id, amount: dec(amount), tds: dec(tds), kind: 'settlement', status: 'paid', reference: (str(dto?.reference) ?? nos).slice(0, 190), notes: `Bill register payment #${String(pay.id)} — ${nos}`.slice(0, 500) },
      }).catch(() => undefined);
    }
    return { ok: true, paymentId: String(pay.id), settled: plan.map((x) => ({ invoiceNo: x.inv.invoiceNo, amount: x.take })), unallocated: pool };
  }

  async listPayments(vendorCode?: string) {
    const rows = await this.prisma.vendorBillPayment.findMany({
      where: vendorCode ? { vendorCode } : undefined, orderBy: [{ paidOn: 'desc' }, { id: 'desc' }], take: 500,
      include: { allocations: { include: { invoice: { select: { invoiceNo: true } } } } },
    });
    return rows.map(({ allocations, ...p }) => ({ ...p, id: String(p.id), invoices: allocations.map((a) => ({ invoiceNo: a.invoice.invoiceNo, amount: Number(a.amount) })) }));
  }

  /** Undo a payment — its allocations come off the invoices again. */
  async deletePayment(id: number) {
    const p = await this.prisma.vendorBillPayment.findUnique({ where: { id: BigInt(id) }, include: { allocations: true } });
    if (!p) throw new NotFoundException('Payment not found');
    await this.prisma.$transaction(async (tx) => {
      for (const a of p.allocations) {
        const inv = await tx.vendorInvoice.findUnique({ where: { id: a.invoiceId } });
        if (!inv) continue;
        const settled = Math.max(0, +(Number(inv.settled) - Number(a.amount)).toFixed(2));
        await tx.vendorInvoice.update({ where: { id: inv.id }, data: { settled: dec(settled), status: settled <= 0 ? 'OPEN' : settled >= Number(inv.grandTotal) - 0.01 ? 'PAID' : 'PARTIAL' } });
      }
      await tx.vendorBillPayment.delete({ where: { id: p.id } });
    });
    return { ok: true };
  }

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
