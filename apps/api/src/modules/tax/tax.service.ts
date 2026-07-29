import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const r2 = (n: number) => +n.toFixed(2);
const dayEnd = (d: string) => new Date(new Date(d).getTime() + 86399999);
/** PAN sits at chars 3–12 of a GSTIN. */
const panFromGstin = (g?: string | null) => (g && g.length >= 12 ? g.slice(2, 12) : null);

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GST outward-supplies register (GSTR-1) + GSTR-3B summary for a period.
   * Built from issued invoices (which already carry the CGST/SGST/IGST split,
   * place of supply and SAC).
   */
  async gst(from: string, to: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { issuedAt: { gte: new Date(from), lte: dayEnd(to) }, status: { not: 'DRAFT' } },
      include: { client: { select: { legalName: true, gstin: true } } },
      orderBy: { issuedAt: 'asc' },
    });

    const rows = invoices.map((i) => ({
      invoiceNo: i.invoiceNo,
      date: i.issuedAt,
      customer: i.client.legalName,
      gstin: i.client.gstin ?? 'URP', // unregistered
      placeOfSupply: i.placeOfSupply,
      sacCode: i.sacCode ?? '9968',
      taxableValue: Number(i.subtotal),
      cgst: Number(i.cgst),
      sgst: Number(i.sgst),
      igst: Number(i.igst),
      total: Number(i.total),
      supplyType: Number(i.igst) > 0 ? 'Inter-state' : 'Intra-state',
      irn: i.irn ?? null,
    }));

    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k]), 0);
    return {
      period: { from, to },
      count: rows.length,
      rows,
      summary: {
        taxableValue: r2(sum('taxableValue')),
        cgst: r2(sum('cgst')),
        sgst: r2(sum('sgst')),
        igst: r2(sum('igst')),
        totalTax: r2(sum('cgst') + sum('sgst') + sum('igst')),
        invoiceTotal: r2(sum('total')),
      },
    };
  }

  /**
   * TDS register for a period.
   * - receivable: TDS deducted BY customers on our freight bills (194C) — from
   *   the ledger 'tds' entries. Needed to reconcile Form 26AS / collect certificates.
   * - payable: TDS WE deducted on vendor payments — for filing Form 26Q.
   */
  async tds(from: string, to: string) {
    const gte = new Date(from);
    const lte = dayEnd(to);

    // ---- receivable (deducted by customers) ----
    const ledger = await this.prisma.ledgerEntry.findMany({
      where: { entryType: 'tds', createdAt: { gte, lte } },
      include: { client: { select: { legalName: true, gstin: true } } },
    });
    const recvMap = new Map<string, { deductor: string; pan: string | null; gstin: string | null; tds: number }>();
    for (const e of ledger) {
      const key = e.clientId.toString();
      const cur = recvMap.get(key) ?? { deductor: e.client.legalName, pan: panFromGstin(e.client.gstin), gstin: e.client.gstin, tds: 0 };
      cur.tds += Math.abs(Number(e.amount));
      recvMap.set(key, cur);
    }
    const receivable = [...recvMap.values()].map((r) => ({ ...r, tds: r2(r.tds) }));

    // ---- payable (deducted by us on vendor payments) — Form 26Q ----
    const vps = await this.prisma.vendorPayment.findMany({
      where: { tds: { gt: 0 }, createdAt: { gte, lte } },
      include: { vendor: { select: { name: true, gstin: true } } },
    });
    const payMap = new Map<string, { deductee: string; pan: string | null; gstin: string | null; section: string; amount: number; tds: number }>();
    for (const v of vps) {
      const key = v.vendorId.toString();
      const cur = payMap.get(key) ?? { deductee: v.vendor.name, pan: panFromGstin(v.vendor.gstin), gstin: v.vendor.gstin, section: '194C', amount: 0, tds: 0 };
      cur.amount += Number(v.amount);
      cur.tds += Number(v.tds);
      payMap.set(key, cur);
    }
    const payable = [...payMap.values()].map((p) => ({ ...p, amount: r2(p.amount), tds: r2(p.tds) }));

    return {
      period: { from, to },
      receivable: { rows: receivable, total: r2(receivable.reduce((s, r) => s + r.tds, 0)) },
      payable: { rows: payable, total: r2(payable.reduce((s, r) => s + r.tds, 0)) },
    };
  }

  /**
   * Tally-compatible import XML for a period:
   *  - Sales vouchers (invoices)
   *  - Receipt vouchers (customer payments) + TDS-receivable journals
   *  - Payment vouchers (vendor payments) with TDS payable
   * Sign convention: debit = negative, credit = positive (each voucher sums to 0).
   * Import via TallyPrime → Gateway → Import → Vouchers.
   */
  async tallyXml(from: string, to: string) {
    const gte = new Date(from);
    const lte = dayEnd(to);

    const [invoices, ledger, vps] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { issuedAt: { gte, lte }, status: { not: 'DRAFT' } },
        include: { client: { select: { legalName: true } } },
        orderBy: { issuedAt: 'asc' },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { entryType: { in: ['payment', 'tds'] }, createdAt: { gte, lte } },
        include: { client: { select: { legalName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.vendorPayment.findMany({
        where: { createdAt: { gte, lte } },
        include: { vendor: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const esc = (s: string) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const tDate = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10).replace(/-/g, '') : '');
    const ent = (ledgerName: string, amount: number, deemedPositive: boolean) =>
      `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(ledgerName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${deemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amount.toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
    const vch = (type: string, num: string, date: Date | null, party: string, lines: string[]) =>
      `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${type}" ACTION="Create">
        <DATE>${tDate(date)}</DATE>
        <VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(num)}</VOUCHERNUMBER>
        <REFERENCE>${esc(num)}</REFERENCE>
        <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
${lines.join('\n')}
      </VOUCHER>
      </TALLYMESSAGE>`;

    const msgs: string[] = [];

    // ---- Sales ----
    for (const i of invoices) {
      const party = i.client.legalName;
      const lines = [ent(party, -Number(i.total), true), ent('Freight Income', Number(i.subtotal), false)];
      if (Number(i.cgst) > 0) lines.push(ent('Output CGST', Number(i.cgst), false));
      if (Number(i.sgst) > 0) lines.push(ent('Output SGST', Number(i.sgst), false));
      if (Number(i.igst) > 0) lines.push(ent('Output IGST', Number(i.igst), false));
      msgs.push(vch('Sales', i.invoiceNo, i.issuedAt, party, lines));
    }

    // ---- Receipts (cash) + TDS-receivable journals ----
    for (const e of ledger) {
      const party = e.client.legalName;
      const amt = Math.abs(Number(e.amount));
      if (amt <= 0) continue;
      if (e.entryType === 'payment') {
        msgs.push(vch('Receipt', `RCPT-${e.id}`, e.createdAt, party, [
          ent('Bank', -amt, true), // bank debit (money in)
          ent(party, amt, false), // party credit
        ]));
      } else {
        // customer-deducted TDS -> TDS Receivable Dr, Party Cr
        msgs.push(vch('Journal', `TDSR-${e.id}`, e.createdAt, party, [
          ent('TDS Receivable', -amt, true),
          ent(party, amt, false),
        ]));
      }
    }

    // ---- Vendor payments (Payment vouchers) with TDS payable ----
    for (const v of vps) {
      const party = v.vendor.name;
      const gross = Number(v.amount);
      const tds = Number(v.tds);
      const net = gross - tds;
      const lines = [ent(party, -gross, true), ent('Bank', net, false)]; // vendor Dr, bank Cr (net)
      if (tds > 0) lines.push(ent('TDS Payable', tds, false)); // TDS payable Cr
      msgs.push(vch('Payment', `VPAY-${v.id}`, v.createdAt, party, lines));
    }

    return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${msgs.join('\n')}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
  }
}
