import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RateService } from './rate.service';
import { COMPANY } from '../../config/company';

const GST_RATE = 0.18; // India GST

// "Customer bill working" column order (59 cols). {header} is the sheet label (may repeat,
// e.g. "Origin" twice); {key} is the unique field in each row object.
const BILL_COLUMNS: { header: string; key: string }[] = [
  'AWBNo', 'BookingDate', 'CustomerCode', 'CustomerName', 'Invoice_No', 'Invoice_Date', 'Cust_Invoice_No', 'Cust_Invoice_Date',
  'Shipment_Value', 'COD_Amount', 'AddField7', 'Vendor_InvoiceNo', 'Shipper', 'ManifestNo', 'VendorCode', 'ProductCode',
  'Origin', 'PaymentType', 'Pieces', 'ChargeWeight', 'Forwarding_AWB', 'Consignee_Name', 'Consignee_Pin', 'DestinationName',
  'ZoneCode', 'DomIntl', ['Origin', 'Origin_2'] as any, 'Content', 'Instruction', 'ContractCustomer', 'Description', 'EntryLocked',
  'Freight', 'AIRWAYBILL CHARGES', 'Emergency Sit. Surhrg.', 'ENVIRONMENTAL SURCHARGE', 'EXTRA DELIVERY LOCATION', 'TDD', 'NDD',
  'FREIGHT ON VALUE', 'OVER SIZE PCS', 'PICKUP CHARGES', 'TOPAY CHARGES', 'VALUABLE CARGO HANDLING CHARGE', 'CHEQUE/DD ON DELIVERY',
  'APPOINTMENT DELIVERY', 'Packaging charges', 'Pikcup charges', 'Reverse pick up ( Topay)', 'DEMMURAGE CHARGE', 'Other Charges 1',
  'Other Charges 2', 'RAS CHARGE', 'Currency Adjustment', 'FuelSurcharge', 'TaxIGST', 'SBCessSGST', 'KKCessCGST', 'TotalSales',
].map((c) => (Array.isArray(c) ? { header: c[0], key: c[1] } : { header: c as string, key: c as string }));

const STATE_NAMES: Record<string, string> = {
  '29': 'Karnataka', '27': 'Maharashtra', '36': 'Telangana', '33': 'Tamil Nadu',
  '07': 'Delhi', '24': 'Gujarat', '06': 'Haryana', '09': 'Uttar Pradesh',
  '19': 'West Bengal', '32': 'Kerala', '08': 'Rajasthan', '37': 'Andhra Pradesh',
  '23': 'Madhya Pradesh', '03': 'Punjab', '10': 'Bihar', '21': 'Odisha',
};
const stateName = (code: string | null): string | null => (code ? STATE_NAMES[code] ?? null : null);

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RateService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Consolidated invoice for a client over a period.
   * Bills only DELIVERED pieces per AWB (partial-delivery logic); short
   * shipments are flagged for structural review on the line.
   */
  async generate(clientId: number, periodStart: string, periodEnd: string) {
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.isCash) {
      throw new BadRequestException(`${client.legalName} is a CASH customer — invoices are not generated (paid at booking/delivery).`);
    }
    if (client.accountType === 'WALLET') {
      throw new BadRequestException(`${client.legalName} is a WALLET (prepaid) customer — charges are deducted from the wallet at booking, so no invoice is generated.`);
    }

    const shipments = await this.prisma.shipment.findMany({
      where: {
        clientId: client.id,
        createdAt: { gte: new Date(periodStart), lte: new Date(periodEnd) },
      },
      include: { pieces: { select: { status: true, deadKg: true, volKg: true, lengthCm: true, widthCm: true, heightCm: true } } },
    });

    // Re-bill guard: never invoice a shipment that already appears on an invoice line.
    const alreadyBilled = new Set(
      (await this.prisma.invoiceLineItem.findMany({
        where: { shipmentId: { in: shipments.map((s) => s.id) } },
        select: { shipmentId: true },
      })).map((l) => l.shipmentId.toString()),
    );

    const lines: {
      shipmentId: bigint;
      chargeableKg: number;
      amount: number;
      freight: number;
      fuel: number;
      otherCharges: number;
      breakup: any;
      disputeReason: string | null;
    }[] = [];
    let subtotal = 0;
    const addonIdsToMark: bigint[] = []; // per-AWB add-on charges pulled onto this invoice

    for (const s of shipments) {
      if (alreadyBilled.has(s.id.toString())) continue; // already invoiced
      if (s.status === 'CANCELLED') continue; // skip cancelled
      // Bill on booking (AWB-list basis): full shipment charges, not delivery-gated.
      const charges = await this.rates.chargesForShipment(s, s.pieces);
      if (!charges) continue; // no rate configured -> skip

      // Per-AWB ad-hoc add-on charges (toBill, not yet billed) fold into this line's "other charges".
      const addons = await this.prisma.shipmentAddon.findMany({ where: { shipmentId: s.id, toBill: true, billedInvoiceId: null }, select: { id: true, amount: true, reason: true } });
      const addonTotal = +addons.reduce((a, x) => a + Number(x.amount), 0).toFixed(2);
      if (addonTotal) { (charges as any).addonLines = addons.map((a) => ({ reason: a.reason, amount: Number(a.amount) })); addonIdsToMark.push(...addons.map((a) => a.id)); }

      const chargeableKg = charges.chargeableKg;
      const amount = +(Number(charges.subtotal) + addonTotal).toFixed(2); // freight + surcharges + add-ons, pre-GST
      const freight = +(Number(charges.freight ?? 0)).toFixed(2);
      const fuel = +(Number(charges.fuel ?? 0)).toFixed(2);
      const otherCharges = +(amount - freight - fuel).toFixed(2); // FOV/ODA/docket/handling/add-ons/etc.
      lines.push({ shipmentId: s.id, chargeableKg, amount, freight, fuel, otherCharges, breakup: charges as any, disputeReason: null });
      subtotal += amount;
    }

    if (lines.length === 0) {
      throw new BadRequestException('No billable shipments in this period. Check that the customer has a rate card / rates set for these AWBs.');
    }

    const tax = +(subtotal * GST_RATE).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);

    // Place of supply → CGST+SGST (intra-state) vs IGST (inter-state).
    const carrierState = COMPANY.stateCode; // Delhi (Excelex) — fixed to the legal entity
    const clientState = client.gstin && client.gstin.length >= 2 ? client.gstin.slice(0, 2) : null;
    const intraState = clientState ? clientState === carrierState : true;
    const cgst = intraState ? +(tax / 2).toFixed(2) : 0;
    const sgst = intraState ? +(tax / 2).toFixed(2) : 0;
    const igst = intraState ? 0 : tax;
    const placeOfSupply = stateName(clientState) ?? client.city ?? stateName(carrierState) ?? 'Delhi';

    const invoiceNo = `INV-${client.accountCode}-${new Date(periodEnd).toISOString().slice(0, 7)}-${Date.now()
      .toString()
      .slice(-5)}`;
    const dueDate = new Date(new Date(periodEnd).getTime() + client.creditDays * 86400000);

    // Created as a DRAFT — editable (add/remove AWBs) and NOT yet posted to the ledger. Locking the
    // invoice (#5) posts the ledger charge + credit exposure and marks it ISSUED. (#8 add/remove before lock.)
    const invoice = await this.prisma.invoice.create({
      data: {
        clientId: client.id,
        invoiceNo,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        subtotal: new Prisma.Decimal(subtotal),
        tax: new Prisma.Decimal(tax),
        cgst: new Prisma.Decimal(cgst),
        sgst: new Prisma.Decimal(sgst),
        igst: new Prisma.Decimal(igst),
        placeOfSupply,
        sacCode: '996812', // SAC for goods transport / courier (matches billing app)
        total: new Prisma.Decimal(total),
        status: InvoiceStatus.DRAFT,
        dueDate,
        issuedAt: new Date(),
        lines: {
          create: lines.map((l) => ({
            shipmentId: l.shipmentId,
            chargeableKg: new Prisma.Decimal(l.chargeableKg),
            amount: new Prisma.Decimal(l.amount),
            freight: new Prisma.Decimal(l.freight),
            fuel: new Prisma.Decimal(l.fuel),
            otherCharges: new Prisma.Decimal(l.otherCharges),
            breakup: l.breakup,
            disputeReason: l.disputeReason,
          })),
        },
      },
      include: { lines: true },
    });

    // Mark the add-on charges as billed so they aren't pulled onto a future invoice.
    if (addonIdsToMark.length) {
      await this.prisma.shipmentAddon.updateMany({ where: { id: { in: addonIdsToMark } }, data: { billedInvoiceId: invoice.id } });
    }

    return { invoice, creditHold: false, draft: true, newBalance: Number(client.outstandingBal), creditLimit: client.creditLimit };
  }

  /** Re-total a DRAFT invoice's tax split from its current line amounts (after add/remove). */
  private async recomputeInvoiceTotals(invoiceId: bigint) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lines: true, client: { select: { gstin: true } } } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const subtotal = +inv.lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2);
    const tax = +(subtotal * GST_RATE).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);
    const carrierState = COMPANY.stateCode;
    const clientState = inv.client.gstin && inv.client.gstin.length >= 2 ? inv.client.gstin.slice(0, 2) : null;
    const intraState = clientState ? clientState === carrierState : true;
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: new Prisma.Decimal(subtotal), tax: new Prisma.Decimal(tax), total: new Prisma.Decimal(total),
        cgst: new Prisma.Decimal(intraState ? +(tax / 2).toFixed(2) : 0),
        sgst: new Prisma.Decimal(intraState ? +(tax / 2).toFixed(2) : 0),
        igst: new Prisma.Decimal(intraState ? 0 : tax),
      },
    });
    return { subtotal, tax, total, lineCount: inv.lines.length };
  }

  /** Add an AWB to a DRAFT invoice (#8). The shipment must be uninvoiced and belong to the same client. */
  async addAwbToInvoice(invoiceId: number, awbRaw: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: BigInt(invoiceId) } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only a DRAFT invoice can be edited — unlock is not allowed once locked.');
    const awb = String(awbRaw || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { awb }, include: { pieces: { select: { status: true, deadKg: true, volKg: true, lengthCm: true, widthCm: true, heightCm: true } } } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (s.clientId !== inv.clientId) throw new BadRequestException(`${awb} belongs to a different customer.`);
    if (s.status === 'CANCELLED') throw new BadRequestException(`${awb} is cancelled.`);
    const existing = await this.prisma.invoiceLineItem.findFirst({ where: { shipmentId: s.id }, select: { invoiceId: true } });
    if (existing) throw new BadRequestException(`${awb} is already on invoice ${existing.invoiceId === inv.id ? 'this one' : '#' + existing.invoiceId}.`);
    const charges = await this.rates.chargesForShipment(s, s.pieces);
    if (!charges) throw new BadRequestException(`No rate configured for ${awb} — cannot bill it.`);
    const amount = charges.subtotal;
    const freight = +(Number(charges.freight ?? 0)).toFixed(2);
    const fuel = +(Number(charges.fuel ?? 0)).toFixed(2);
    await this.prisma.invoiceLineItem.create({
      data: {
        invoiceId: inv.id, shipmentId: s.id,
        chargeableKg: new Prisma.Decimal(charges.chargeableKg), amount: new Prisma.Decimal(amount),
        freight: new Prisma.Decimal(freight), fuel: new Prisma.Decimal(fuel),
        otherCharges: new Prisma.Decimal(+(amount - freight - fuel).toFixed(2)), breakup: charges as any, disputeReason: null,
      },
    });
    const totals = await this.recomputeInvoiceTotals(inv.id);
    return { ok: true, awb, ...totals, message: `${awb} added.` };
  }

  /** Remove an AWB line from a DRAFT invoice (#8). */
  async removeAwbFromInvoice(invoiceId: number, shipmentId: number) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: BigInt(invoiceId) } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only a DRAFT invoice can be edited.');
    const line = await this.prisma.invoiceLineItem.findFirst({ where: { invoiceId: inv.id, shipmentId: BigInt(shipmentId) } });
    if (!line) throw new NotFoundException('That AWB is not on this invoice.');
    await this.prisma.invoiceLineItem.delete({ where: { id: line.id } });
    const totals = await this.recomputeInvoiceTotals(inv.id);
    return { ok: true, ...totals, message: 'AWB removed.' };
  }

  /** Lock (issue) a DRAFT invoice (#5): posts the ledger charge + credit exposure and marks it ISSUED. */
  async lockInvoice(invoiceId: number) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: BigInt(invoiceId) }, include: { _count: { select: { lines: true } } } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Invoice is already locked.');
    if (inv._count.lines === 0) throw new BadRequestException('Cannot lock an empty invoice — add at least one AWB.');
    const client = await this.prisma.b2bClient.findUnique({ where: { id: inv.clientId } });
    if (!client) throw new NotFoundException('Client not found');
    const total = Number(inv.total);
    const newBalance = +(Number(client.outstandingBal) + total).toFixed(2);
    await this.prisma.ledgerEntry.create({
      data: { clientId: client.id, invoiceId: inv.id, entryType: 'charge', amount: new Prisma.Decimal(total), balanceAfter: new Prisma.Decimal(newBalance) },
    });
    const overLimit = newBalance > Number(client.creditLimit);
    await this.prisma.b2bClient.update({ where: { id: client.id }, data: { outstandingBal: new Prisma.Decimal(newBalance), isCreditHold: overLimit } });
    const updated = await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() } });
    await this.notifications.notify({
      channel: 'email', recipient: client.accountCode, kind: 'invoice',
      message: `Invoice ${inv.invoiceNo} issued: ₹${total} due ${new Date(inv.dueDate).toISOString().slice(0, 10)}${overLimit ? ' — ACCOUNT ON CREDIT HOLD' : ''}.`,
    });
    return { invoice: updated, creditHold: overLimit, newBalance, creditLimit: client.creditLimit };
  }

  /** Lock many invoices at once (single / multiple / all). `all` locks every DRAFT invoice.
   *  Already-locked or empty invoices are skipped, not fatal. */
  async lockMany(ids: number[] | null, all?: boolean) {
    let targetIds: bigint[];
    if (all) {
      const drafts = await this.prisma.invoice.findMany({ where: { status: InvoiceStatus.DRAFT }, select: { id: true } });
      targetIds = drafts.map((d) => d.id);
    } else {
      targetIds = (ids ?? []).map((x) => BigInt(x));
    }
    let locked = 0; const skipped: { id: string; reason: string }[] = [];
    for (const id of targetIds) {
      try { await this.lockInvoice(Number(id)); locked++; }
      catch (e: any) { skipped.push({ id: id.toString(), reason: e?.message || 'failed' }); }
    }
    return { ok: true, locked, skipped };
  }

  /** Generate GST e-invoice IRNs for many invoices at once. */
  async einvoiceMany(ids: number[]) {
    let done = 0; const failed: { id: string; reason: string }[] = [];
    for (const id of ids ?? []) {
      try { await this.generateEInvoice(Number(id)); done++; }
      catch (e: any) { failed.push({ id: String(id), reason: e?.message || 'failed' }); }
    }
    return { ok: true, done, failed };
  }

  /** Delete an invoice (#4). DRAFT deletes freely; a locked (ISSUED) invoice reverses its ledger charge and
   *  frees the AWBs to be billed again. Blocked once any payment/adjustment has been recorded against it. */
  async deleteInvoice(invoiceId: number) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: BigInt(invoiceId) } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const entries = await this.prisma.ledgerEntry.findMany({ where: { invoiceId: inv.id } });
    const hasPayment = entries.some((e) => e.entryType !== 'charge');
    if (hasPayment || inv.status === InvoiceStatus.PAID || inv.status === InvoiceStatus.PARTIALLY_PAID) {
      throw new BadRequestException('This invoice has payments recorded — reverse the payment before deleting.');
    }
    // Reverse the ledger impact (net of this invoice's entries) off the client's balance, then remove them.
    const net = entries.reduce((s, e) => s + Number(e.amount), 0);
    if (net !== 0) {
      const client = await this.prisma.b2bClient.findUnique({ where: { id: inv.clientId } });
      if (client) {
        const newBalance = +(Number(client.outstandingBal) - net).toFixed(2);
        await this.prisma.b2bClient.update({ where: { id: client.id }, data: { outstandingBal: new Prisma.Decimal(newBalance), isCreditHold: newBalance > Number(client.creditLimit) } });
      }
    }
    if (entries.length) await this.prisma.ledgerEntry.deleteMany({ where: { invoiceId: inv.id } });
    await this.prisma.invoice.delete({ where: { id: inv.id } }); // cascades invoice lines → frees the AWBs
    return { ok: true, invoiceId, invoiceNo: inv.invoiceNo, message: `Invoice ${inv.invoiceNo} deleted.` };
  }

  /**
   * Sales MIS — per-customer summary over a date range: shipments, pieces, weights, status split
   * (delivered/RTO/undelivered/pending), billed vs unbilled, billed sales/fuel/tax, cash received &
   * outstanding. Sales come from invoiced lines (fast, no live re-rating); outstanding is the live balance.
   */
  async misSalesSummary(from?: string, to?: string) {
    const gte = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const lte = to ? new Date(`${to}T23:59:59`) : new Date();
    const [ships, lineItems, payAgg] = await Promise.all([
      this.prisma.shipment.findMany({
        where: { createdAt: { gte, lte } },
        select: { id: true, clientId: true, pieceCount: true, totalDeadKg: true, totalVolKg: true, chargeWeight: true, statusCode: true,
          client: { select: { legalName: true, accountCode: true, outstandingBal: true } } },
      }),
      this.prisma.invoiceLineItem.findMany({
        where: { shipment: { createdAt: { gte, lte } } },
        select: { shipmentId: true, amount: true, fuel: true, shipment: { select: { clientId: true } } },
      }),
      this.prisma.ledgerEntry.groupBy({ by: ['clientId'], where: { createdAt: { gte, lte }, amount: { lt: 0 } }, _sum: { amount: true } }),
    ]);
    const cashBy = new Map(payAgg.map((p) => [String(p.clientId), -Number(p._sum.amount || 0)]));
    const billedIds = new Set(lineItems.map((l) => l.shipmentId.toString()));
    const M = new Map<string, any>();
    const n2 = (x: number) => +Number(x || 0).toFixed(2);
    for (const s of ships) {
      const k = String(s.clientId);
      if (!M.has(k)) M.set(k, { code: s.client?.accountCode ?? '', customer: s.client?.legalName ?? '', shipments: 0, pcs: 0, actlKg: 0, chrgKg: 0, totalSales: 0, fuel: 0, tax: 0, netSales: 0, billed: 0, unbilled: 0, delivered: 0, rto: 0, undelivered: 0, pending: 0, cashReceived: cashBy.get(k) || 0, outstanding: Number(s.client?.outstandingBal || 0) });
      const r = M.get(k);
      r.shipments++; r.pcs += s.pieceCount || 0;
      r.actlKg += Number(s.totalDeadKg || 0);
      r.chrgKg += s.chargeWeight != null ? Number(s.chargeWeight) : Math.max(Number(s.totalDeadKg || 0), Number(s.totalVolKg || 0));
      const sc = String(s.statusCode || 'MAN');
      if (sc === 'DLD') r.delivered++; else if (['RTO', 'RTD'].includes(sc)) r.rto++; else if (sc === 'UDL') r.undelivered++; else r.pending++;
      if (billedIds.has(s.id.toString())) r.billed++; else r.unbilled++;
    }
    for (const l of lineItems) {
      const cid = l.shipment?.clientId; if (cid == null) continue;
      const r = M.get(String(cid)); if (!r) continue;
      const amt = Number(l.amount || 0); r.totalSales += amt; r.fuel += Number(l.fuel || 0); r.tax += amt * 0.18;
    }
    const rows = [...M.values()].map((r) => ({ ...r, actlKg: n2(r.actlKg), chrgKg: n2(r.chrgKg), totalSales: n2(r.totalSales), fuel: n2(r.fuel), tax: n2(r.tax), netSales: n2(r.totalSales), cashReceived: n2(r.cashReceived), outstanding: n2(r.outstanding) }))
      .sort((a, b) => b.totalSales - a.totalSales);
    const totals: any = {};
    for (const k of ['shipments', 'pcs', 'actlKg', 'chrgKg', 'totalSales', 'fuel', 'tax', 'netSales', 'billed', 'unbilled', 'delivered', 'rto', 'undelivered', 'pending', 'cashReceived', 'outstanding']) totals[k] = n2(rows.reduce((t, r) => t + (r as any)[k], 0));
    return { from: gte, to: lte, count: rows.length, rows, totals };
  }

  /**
   * Sales dashboard by salesperson — their daily contribution: shipments booked and sales for THEIR
   * customers, split billed vs unbilled (unbilled is live-rated). Grouped on the customer's salesPerson.
   */
  async salesByRep(from?: string, to?: string) {
    const gte = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
    const lte = to ? new Date(`${to}T23:59:59`) : new Date();
    const ships = await this.prisma.shipment.findMany({
      where: { createdAt: { gte, lte } }, take: 3000,
      include: { pieces: { select: { status: true, deadKg: true, volKg: true, lengthCm: true, widthCm: true, heightCm: true } },
        client: { select: { salesPerson: true, salesPersonMobile: true, salesPersonEmail: true } } },
    });
    const billed = new Map((await this.prisma.invoiceLineItem.findMany({ where: { shipment: { createdAt: { gte, lte } } }, select: { shipmentId: true, amount: true } })).map((l) => [l.shipmentId.toString(), Number(l.amount)]));
    const n2 = (x: number) => +Number(x || 0).toFixed(2);
    const M = new Map<string, any>();
    for (const s of ships) {
      const rep = (s.client?.salesPerson || '(unassigned)').trim() || '(unassigned)';
      if (!M.has(rep)) M.set(rep, { salesPerson: rep, mobile: s.client?.salesPersonMobile ?? '', email: s.client?.salesPersonEmail ?? '', shipments: 0, billedCount: 0, unbilledCount: 0, billedSales: 0, unbilledSales: 0 });
      const r = M.get(rep); r.shipments++;
      const b = billed.get(s.id.toString());
      if (b != null) { r.billedCount++; r.billedSales += b; }
      else { r.unbilledCount++; const ch = await this.rates.chargesForShipment(s as any, s.pieces as any); r.unbilledSales += ch ? Number(ch.subtotal || 0) : 0; }
    }
    const rows = [...M.values()].map((r) => ({ ...r, billedSales: n2(r.billedSales), unbilledSales: n2(r.unbilledSales), totalSales: n2(r.billedSales + r.unbilledSales) })).sort((a, b) => b.totalSales - a.totalSales);
    const totals: any = {};
    for (const k of ['shipments', 'billedCount', 'unbilledCount', 'billedSales', 'unbilledSales', 'totalSales']) totals[k] = n2(rows.reduce((t, r) => t + r[k], 0));
    return { from: gte, to: lte, count: rows.length, rows, totals };
  }

  /** Customer ids with at least one shipment in the period, excluding cash/wallet (prepaid) accounts. */
  async eligibleClientIdsForPeriod(periodStart: string, periodEnd: string): Promise<number[]> {
    const grouped = await this.prisma.shipment.groupBy({
      by: ['clientId'],
      where: { createdAt: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      _count: { _all: true },
    });
    const ids = grouped.map((g) => g.clientId);
    if (!ids.length) return [];
    const clients = await this.prisma.b2bClient.findMany({
      where: { id: { in: ids }, isCash: false, NOT: { accountType: 'WALLET' } },
      select: { id: true },
    });
    return clients.map((c) => Number(c.id));
  }

  /**
   * Batch invoice run over many customers. Each customer is billed independently — one with no
   * billable shipments (or already fully billed) is skipped, not fatal, so an "all customers" run
   * still completes. Returns a per-customer summary.
   */
  async generateMany(clientIds: number[], periodStart: string, periodEnd: string) {
    const results: { clientId: number; ok: boolean; invoiceNo?: string; total?: number; creditHold?: boolean; error?: string }[] = [];
    for (const cid of clientIds) {
      try {
        const r = await this.generate(cid, periodStart, periodEnd);
        results.push({ clientId: cid, ok: true, invoiceNo: r.invoice.invoiceNo, total: Number(r.invoice.total), creditHold: r.creditHold });
      } catch (e: any) {
        results.push({ clientId: cid, ok: false, error: e?.message || 'failed' });
      }
    }
    const created = results.filter((r) => r.ok);
    return {
      created: created.length,
      skipped: results.length - created.length,
      totalBilled: +created.reduce((s, r) => s + (r.total || 0), 0).toFixed(2),
      creditHolds: created.filter((r) => r.creditHold).length,
      results,
    };
  }

  /**
   * Bill-working export — one row per AWB with every charge head, matching the
   * "Customer bill working" sheet columns exactly (59 cols). Charges come from the
   * live rate engine; unrated AWBs show zeros.
   */
  async billWorksheet(clientId: number, from?: string, to?: string) {
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) } });
    if (!client) throw new NotFoundException('Client not found');
    // Cash / Wallet (prepaid) customers are settled at booking — never part of the billing run.
    if (client.isCash || client.accountType === 'WALLET') {
      return { columns: BILL_COLUMNS, client: { accountCode: client.accountCode, legalName: client.legalName }, count: 0, rows: [] };
    }
    const where: any = { clientId: client.id };
    if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const shipments = await this.prisma.shipment.findMany({
      where, orderBy: { createdAt: 'asc' }, take: 5000,
      include: { pieces: { select: { status: true, deadKg: true, volKg: true, lengthCm: true, widthCm: true, heightCm: true } } },
    });

    const carrierState = COMPANY.stateCode;
    const clientState = client.gstin && client.gstin.length >= 2 ? client.gstin.slice(0, 2) : null;
    const intraState = clientState ? clientState === carrierState : true;
    const vendorCode = (v?: string | null) => (v && String(v).toUpperCase().startsWith('BLUEDART') ? 'BDR' : (v || 'SELF'));
    const d10 = (dt: any) => (dt ? new Date(dt).toISOString().slice(0, 10) : '');

    const rows: Record<string, any>[] = [];
    for (const s of shipments) {
      const b: any = (await this.rates.chargesForShipment(s, s.pieces)) || {};
      const num = (x: any) => +(Number(x ?? 0)).toFixed(2);
      const reverseProd = ['TAPEX', 'TOSFC', 'TODP'].includes(String(s.product ?? '').toUpperCase());
      const sub = num(b.subtotal);
      const gst = +(sub * GST_RATE).toFixed(2);
      rows.push({
        AWBNo: s.awb, BookingDate: d10(s.createdAt), CustomerCode: client.accountCode, CustomerName: client.legalName,
        Invoice_No: '', Invoice_Date: '', Cust_Invoice_No: s.referenceNo ?? '', Cust_Invoice_Date: '',
        Shipment_Value: num(s.shipmentValue ?? s.declaredValue), COD_Amount: 0, AddField7: '', Vendor_InvoiceNo: '',
        Shipper: s.shipperName ?? '', ManifestNo: '', VendorCode: vendorCode(s.vendor), ProductCode: s.product ?? '',
        Origin: s.originZone ?? '', PaymentType: s.paymentTerm === 'TO_PAY' ? 'T' : 'R', Pieces: s.pieceCount,
        ChargeWeight: num(b.chargeableKg), Forwarding_AWB: s.awb, Consignee_Name: s.consigneeName ?? '',
        Consignee_Pin: s.destPincode ?? '', DestinationName: s.consigneeCity ?? '', ZoneCode: s.destZone ?? '',
        DomIntl: 'D', Origin_2: s.originZone ?? '', Content: s.goodsDesc ?? '', Instruction: '', ContractCustomer: 'Y',
        Description: '', EntryLocked: 'Unlocked',
        Freight: num(b.freight), 'AIRWAYBILL CHARGES': num(b.awb), 'Emergency Sit. Surhrg.': num(b.emergency),
        'ENVIRONMENTAL SURCHARGE': num(b.environment), 'EXTRA DELIVERY LOCATION': num(b.oda), TDD: 0, NDD: 0,
        'FREIGHT ON VALUE': num(b.fov), 'OVER SIZE PCS': num(b.osp), 'PICKUP CHARGES': 0,
        'TOPAY CHARGES': reverseProd ? 0 : num(b.topay),
        'VALUABLE CARGO HANDLING CHARGE': num(b.handling), 'CHEQUE/DD ON DELIVERY': num(b.dod), 'APPOINTMENT DELIVERY': num(b.appt),
        'Packaging charges': 0, 'Pikcup charges': 0, 'Reverse pick up ( Topay)': reverseProd ? num(b.topay) : 0, 'DEMMURAGE CHARGE': 0,
        'Other Charges 1': num(b.loading), 'Other Charges 2': num(b.unloading), 'RAS CHARGE': num(b.ras), 'Currency Adjustment': 0,
        FuelSurcharge: num(b.fuel), TaxIGST: intraState ? 0 : gst, SBCessSGST: intraState ? +(gst / 2).toFixed(2) : 0,
        KKCessCGST: intraState ? +(gst / 2).toFixed(2) : 0, TotalSales: +(sub + gst).toFixed(2),
      });
    }
    return { columns: BILL_COLUMNS, client: { accountCode: client.accountCode, legalName: client.legalName }, count: rows.length, rows };
  }

  /**
   * AWB-wise profit/loss: vendor cost (uploaded vendor bills) vs our sell (rate engine).
   * Matches a vendor bill to our shipment by carrier waybill (bdWaybill) or our AWB.
   */
  async pnl(from?: string, to?: string) {
    const where: any = {};
    if (from || to) where.pickupDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const bills = await this.prisma.vendorBill.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
    const rows: any[] = [];
    let totSell = 0, totCost = 0;
    for (const b of bills) {
      const ship = await this.prisma.shipment.findFirst({
        where: { OR: [{ forwardingAwb: b.awb }, { bdWaybill: b.awb }, { awb: b.awb }] },
        include: { pieces: true, client: { select: { legalName: true, accountCode: true, isCash: true, accountType: true } } },
      });
      // Cash / Wallet (prepaid) shipments are settled at booking — excluded from P&L.
      if (ship?.client && (ship.client.isCash || ship.client.accountType === 'WALLET')) continue;
      let sell = 0, ourAwb: string | null = null, customer: string | null = null;
      if (ship) {
        const ch = await this.rates.chargesForShipment(ship, ship.pieces);
        sell = ch ? +(ch.subtotal * (1 + GST_RATE)).toFixed(2) : 0;
        ourAwb = ship.awb; customer = ship.client?.legalName ?? null;
      }
      const cost = Number(b.totalWithGst || b.total);
      totSell += sell; totCost += cost;
      rows.push({
        vendorAwb: b.awb, ourAwb, customer, vendorCode: b.vendorCode, product: b.product,
        origin: b.origin, destination: b.destination, chrgWeight: Number(b.chrgWeight ?? 0),
        cost: +cost.toFixed(2), sell, margin: +(sell - cost).toFixed(2), matched: !!ship,
      });
    }
    return { count: rows.length, totalSell: +totSell.toFixed(2), totalCost: +totCost.toFixed(2), totalMargin: +(totSell - totCost).toFixed(2), rows };
  }

  /**
   * GST e-invoice registration. SANDBOX: generates a 64-char IRN + ack number.
   * Wire an IRP/GSP API here for production (NIC IRP via a GSP).
   */
  async generateEInvoice(invoiceId: number) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: BigInt(invoiceId) } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.irn) return { invoiceId, irn: inv.irn, ackNo: inv.irnAckNo, mode: 'EXISTING' };

    const hex = '0123456789abcdef';
    const irn = Array.from({ length: 64 }, () => hex[Math.floor(Math.random() * 16)]).join('');
    const ackNo = Date.now().toString();
    await this.prisma.invoice.update({
      where: { id: inv.id },
      data: { irn, irnAckNo: ackNo, irnAckedAt: new Date() },
    });
    return {
      invoiceId,
      irn,
      ackNo,
      mode: 'SANDBOX',
      note: 'Simulated IRN. Configure an IRP/GSP for live e-invoicing.',
    };
  }

  list(clientId?: bigint) {
    return this.prisma.invoice.findMany({
      where: clientId != null ? { clientId } : undefined,
      orderBy: { issuedAt: 'desc' },
      include: { lines: true },
    });
  }

  async get(id: number) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: BigInt(id) },
      include: {
        lines: { include: { shipment: { select: { awb: true, originZone: true, destZone: true, createdAt: true, consigneeCity: true } } } },
        client: {
          select: {
            legalName: true, accountCode: true, gstin: true,
            addressLine: true, city: true, pincode: true, state: true, contactPhone: true, contactEmail: true,
          },
        },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  /**
   * Charge-breakup export data: one flat row per billed AWB with each charge head
   * (freight/fuel/fov/oda/docket/handling/awb/…) in its own field, plus a head-wise
   * summary. Filtered by client and/or period (matches the Invoice Printing panel).
   * Heads come from the stored per-line breakup; legacy lines fall back to freight/
   * fuel/other so nothing is lost.
   */
  async chargeBreakup(clientId?: number, from?: string, to?: string) {
    const where: Prisma.InvoiceWhereInput = {};
    if (clientId) where.clientId = BigInt(clientId);
    if (from || to) where.periodEnd = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };

    const invoices = await this.prisma.invoice.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      include: {
        client: { select: { legalName: true, accountCode: true, gstin: true } },
        lines: { include: { shipment: { select: { awb: true, createdAt: true, consigneeCity: true, destZone: true, vendor: true, product: true } } } },
      },
    });

    // canonical head order + labels
    const HEADS: { key: string; label: string }[] = [
      { key: 'freight', label: 'Freight' }, { key: 'fuel', label: 'Fuel Surcharge' },
      { key: 'fov', label: 'FOV' }, { key: 'oda', label: 'ODA' },
      { key: 'docket', label: 'Docket' }, { key: 'handling', label: 'Handling' },
      { key: 'awb', label: 'AWB Chg' }, { key: 'appt', label: 'Appointment' },
      { key: 'loading', label: 'Loading' }, { key: 'unloading', label: 'Unloading' },
      { key: 'emergency', label: 'Emergency' }, { key: 'environment', label: 'Environment' },
      { key: 'osp', label: 'OSP' }, { key: 'topay', label: 'To-Pay' },
    ];
    const n = (v: any) => +(Number(v ?? 0)).toFixed(2);

    const rows: any[] = [];
    const headTotals: Record<string, number> = {};
    let taxableSum = 0, cgstSum = 0, sgstSum = 0, igstSum = 0, grandSum = 0, kgSum = 0;

    for (const inv of invoices) {
      const isIntra = n(inv.cgst) > 0 || n(inv.sgst) > 0;
      for (const l of inv.lines) {
        const bk: any = (l as any).breakup ?? null;
        const heads: Record<string, number> = {};
        for (const h of HEADS) {
          let v = bk ? n(bk[h.key]) : 0;
          // legacy fallback (no stored breakup): map the 3-way split
          if (!bk) { if (h.key === 'freight') v = n(l.freight) || n(l.amount); else if (h.key === 'fuel') v = n(l.fuel); }
          heads[h.key] = v;
          headTotals[h.key] = +( (headTotals[h.key] ?? 0) + v ).toFixed(2);
        }
        const taxable = n(l.amount);
        // Anything in the line total not captured by the named heads (e.g. custom charges like MCC/
        // RAS/PSS that live only in the breakup's `lines`) → a generic "Other Charges" bucket so the
        // row always reconciles: Σ heads = taxable value.
        const captured = Object.values(heads).reduce((s, v) => s + v, 0);
        const other = +(taxable - captured).toFixed(2);
        if (other > 0.01) { heads['other'] = other; headTotals['other'] = +((headTotals['other'] ?? 0) + other).toFixed(2); }
        const gst = +(taxable * GST_RATE).toFixed(2);
        taxableSum += taxable; grandSum += taxable + gst; kgSum += n(l.chargeableKg);
        if (isIntra) { cgstSum += gst / 2; sgstSum += gst / 2; } else { igstSum += gst; }
        rows.push({
          invoiceNo: inv.invoiceNo,
          awb: l.shipment?.awb ?? String(l.shipmentId),
          bookingDate: l.shipment?.createdAt ?? null,
          destination: l.shipment?.consigneeCity ?? l.shipment?.destZone ?? '',
          vendor: l.shipment?.vendor ?? '',
          product: l.shipment?.product ?? '',
          chargeableKg: n(l.chargeableKg),
          heads,
          taxable,
          gstPct: 18,
          gst,
          total: +(taxable + gst).toFixed(2),
        });
      }
    }

    // only expose heads that are non-zero somewhere (+ generic Other if used)
    const activeHeads = HEADS.filter((h) => (headTotals[h.key] ?? 0) !== 0);
    if ((headTotals['other'] ?? 0) !== 0) activeHeads.push({ key: 'other', label: 'Other Charges' });

    return {
      client: invoices[0]?.client ?? null,
      from: from ?? null,
      to: to ?? null,
      heads: activeHeads,
      rows,
      summary: {
        invoices: invoices.length,
        awbs: rows.length,
        chargeableKg: +kgSum.toFixed(3),
        headTotals,
        taxable: +taxableSum.toFixed(2),
        cgst: +cgstSum.toFixed(2),
        sgst: +sgstSum.toFixed(2),
        igst: +igstSum.toFixed(2),
        grandTotal: +grandSum.toFixed(2),
      },
    };
  }

  /** Clear a line's dispute and unlock it; if no disputed lines remain, the invoice returns to ISSUED. */
  async undispute(invoiceId: number, shipmentId: number) {
    const line = await this.prisma.invoiceLineItem.findFirst({ where: { invoiceId: BigInt(invoiceId), shipmentId: BigInt(shipmentId) } });
    if (!line) throw new NotFoundException('Invoice line for that shipment not found');
    await this.prisma.invoiceLineItem.update({ where: { id: line.id }, data: { isDisputed: false, disputeReason: null } });
    const stillDisputed = await this.prisma.invoiceLineItem.count({ where: { invoiceId: BigInt(invoiceId), isDisputed: true } });
    if (stillDisputed === 0) {
      const inv = await this.prisma.invoice.findUnique({ where: { id: BigInt(invoiceId) }, select: { status: true } });
      if (inv?.status === InvoiceStatus.DISPUTED) {
        await this.prisma.invoice.update({ where: { id: BigInt(invoiceId) }, data: { status: InvoiceStatus.ISSUED } });
      }
    }
    return { invoiceId, cleared: shipmentId, remainingDisputed: stillDisputed };
  }

  /** Lock a single line under dispute; clean lines stay payable. */
  async dispute(invoiceId: number, shipmentId: number, reason: string) {
    const line = await this.prisma.invoiceLineItem.findFirst({
      where: { invoiceId: BigInt(invoiceId), shipmentId: BigInt(shipmentId) },
    });
    if (!line) throw new NotFoundException('Invoice line for that shipment not found');

    await this.prisma.invoiceLineItem.update({
      where: { id: line.id },
      data: { isDisputed: true, disputeReason: reason },
    });
    await this.prisma.invoice.update({
      where: { id: BigInt(invoiceId) },
      data: { status: InvoiceStatus.DISPUTED },
    });

    const lines = await this.prisma.invoiceLineItem.findMany({ where: { invoiceId: BigInt(invoiceId) } });
    const disputed = lines.filter((l) => l.isDisputed);
    const cleanOpen = lines.filter((l) => !l.isDisputed);
    return {
      invoiceId,
      lockedLines: disputed.length,
      cleanOpenLines: cleanOpen.length,
      cleanOpenAmount: cleanOpen.reduce((s, l) => s + Number(l.amount), 0),
    };
  }

  /**
   * Record a payment against the client's ledger.
   * `amount` is cash received; TDS and other deductions also clear the receivable
   * (the client effectively remitted them on your behalf), so the invoice settles
   * for amount + tds + other. Each is a separate ledger entry for audit.
   */
  async pay(
    invoiceId: number,
    amount: number,
    tds = 0,
    other = 0,
    otherNote?: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: BigInt(invoiceId) } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const client = await this.prisma.b2bClient.findUnique({ where: { id: invoice.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const settled = +(amount + tds + other).toFixed(2);
    let balance = Number(client.outstandingBal);

    const entry = async (entryType: string, amt: number) => {
      balance = +(balance - amt).toFixed(2);
      await this.prisma.ledgerEntry.create({
        data: {
          clientId: client.id,
          invoiceId: invoice.id,
          entryType,
          amount: new Prisma.Decimal(-amt),
          balanceAfter: new Prisma.Decimal(balance),
        },
      });
    };
    if (amount > 0) await entry('payment', amount);
    if (tds > 0) await entry('tds', tds);
    if (other > 0) await entry(otherNote ? `adjustment:${otherNote}` : 'adjustment', other);

    const fullyPaid = settled >= Number(invoice.total) - 0.01;
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: fullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID },
    });
    const stillOverLimit = balance > Number(client.creditLimit);
    await this.prisma.b2bClient.update({
      where: { id: client.id },
      data: { outstandingBal: new Prisma.Decimal(balance), isCreditHold: stillOverLimit },
    });
    return { invoiceId, received: amount, tds, other, settled, newBalance: balance, fullyPaid, creditHold: stillOverLimit };
  }

  /**
   * Statement of Account: full ledger for a client + per-invoice outstanding.
   * Per-invoice remaining = signed sum of its ledger entries (charge/debit note
   * positive, payment/credit note negative).
   */
  async statement(clientId: number) {
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) } });
    if (!client) throw new NotFoundException('Client not found');

    const ledger = await this.prisma.ledgerEntry.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: 'asc' },
    });
    const invoices = await this.prisma.invoice.findMany({
      where: { clientId: client.id },
      orderBy: { issuedAt: 'desc' },
      select: { id: true, invoiceNo: true, periodStart: true, periodEnd: true, total: true, status: true, dueDate: true, issuedAt: true },
    });
    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['invoiceId'],
      where: { clientId: client.id, invoiceId: { not: null } },
      _sum: { amount: true },
    });
    const remainingByInvoice = new Map(sums.map((s) => [String(s.invoiceId), Number(s._sum.amount ?? 0)]));

    return {
      client: {
        id: client.id, legalName: client.legalName, accountCode: client.accountCode,
        gstin: client.gstin, creditLimit: client.creditLimit, creditDays: client.creditDays,
        outstandingBal: client.outstandingBal, isCreditHold: client.isCreditHold,
        canCheckRates: (client as any).canCheckRates ?? false,
      },
      invoices: invoices.map((i) => ({ ...i, remaining: +(remainingByInvoice.get(String(i.id)) ?? Number(i.total)).toFixed(2) })),
      ledger,
    };
  }

  /**
   * Receivables aging across all clients. Buckets each open invoice's remaining
   * balance by days past its due date.
   */
  async aging() {
    const openStatuses: InvoiceStatus[] = [
      InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.DISPUTED, InvoiceStatus.LOCKED,
    ];
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: openStatuses } },
      select: { id: true, clientId: true, total: true, dueDate: true, client: { select: { legalName: true, accountCode: true } } },
    });
    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { not: null } },
      _sum: { amount: true },
    });
    const remainingByInvoice = new Map(sums.map((s) => [String(s.invoiceId), Number(s._sum.amount ?? 0)]));

    const now = Date.now();
    const empty = () => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });
    const rows = new Map<string, { clientId: string; legalName: string; accountCode: string } & ReturnType<typeof empty>>();
    const grand = empty();

    for (const inv of invoices) {
      const remaining = +(remainingByInvoice.get(String(inv.id)) ?? Number(inv.total)).toFixed(2);
      if (remaining <= 0.01) continue;
      const key = String(inv.clientId);
      if (!rows.has(key)) rows.set(key, { clientId: key, legalName: inv.client.legalName, accountCode: inv.client.accountCode, ...empty() });
      const r = rows.get(key)!;
      const daysOverdue = Math.floor((now - new Date(inv.dueDate).getTime()) / 86400000);
      const bucket = daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? 'd1_30' : daysOverdue <= 60 ? 'd31_60' : daysOverdue <= 90 ? 'd61_90' : 'd90_plus';
      r[bucket] += remaining; r.total += remaining;
      grand[bucket] += remaining; grand.total += remaining;
    }
    const round = (o: any) => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = +o[k].toFixed(2); return o; };
    return { rows: [...rows.values()].map(round).sort((a, b) => b.total - a.total), totals: round(grand) };
  }

  async getCredit(clientId: number) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) } });
    if (!c) throw new NotFoundException('Client not found');
    return {
      clientId: c.id,
      legalName: c.legalName,
      creditLimit: c.creditLimit,
      creditDays: c.creditDays,
      outstandingBalance: c.outstandingBal,
      available: +(Number(c.creditLimit) - Number(c.outstandingBal)).toFixed(2),
      isCreditHold: c.isCreditHold,
    };
  }

  /** Customer 360 — profile, credit, KPIs, aging, invoices, ledger, rate cards, recent shipments. */
  async customerOverview(clientId: number) {
    const cid = BigInt(clientId);
    const client = await this.prisma.b2bClient.findUnique({ where: { id: cid } });
    if (!client) throw new NotFoundException('Client not found');
    const r2n = (n: number) => +Number(n).toFixed(2);
    const now = Date.now();
    const nowD = new Date();
    const fyStart = new Date(nowD.getMonth() >= 3 ? nowD.getFullYear() : nowD.getFullYear() - 1, 3, 1); // 1 Apr
    const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1);

    // invoices + per-invoice remaining (signed sum of ledger entries)
    const invoices = await this.prisma.invoice.findMany({
      where: { clientId: cid }, orderBy: { issuedAt: 'desc' },
      select: { id: true, invoiceNo: true, periodStart: true, periodEnd: true, total: true, status: true, dueDate: true, issuedAt: true },
    });
    const sums = await this.prisma.ledgerEntry.groupBy({ by: ['invoiceId'], where: { clientId: cid, invoiceId: { not: null } }, _sum: { amount: true } });
    const remMap = new Map(sums.map((s) => [String(s.invoiceId), Number(s._sum.amount ?? 0)]));
    const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 } as Record<string, number>;
    const invRows = invoices.map((i) => {
      const total = Number(i.total);
      const remaining = r2n(remMap.has(String(i.id)) ? Number(remMap.get(String(i.id))) : total);
      const daysOverdue = Math.floor((now - new Date(i.dueDate).getTime()) / 86400000);
      const paidStatus = remaining <= 0.01 ? 'PAID' : remaining < total - 0.01 ? 'PART-PAID' : daysOverdue > 0 ? 'OVERDUE' : 'OPEN';
      if (remaining > 0.01) {
        const b = daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? 'd1_30' : daysOverdue <= 60 ? 'd31_60' : daysOverdue <= 90 ? 'd61_90' : 'd90_plus';
        aging[b] += remaining; aging.total += remaining;
      }
      return { id: String(i.id), invoiceNo: i.invoiceNo, periodStart: i.periodStart, periodEnd: i.periodEnd, total, remaining, status: i.status, dueDate: i.dueDate, daysOverdue: Math.max(0, daysOverdue), paidStatus };
    });
    for (const k of Object.keys(aging)) aging[k] = r2n(aging[k]);

    const ledger = await this.prisma.ledgerEntry.findMany({ where: { clientId: cid }, orderBy: { createdAt: 'desc' }, take: 15 });
    const rateCards = await this.prisma.customerRateCard.findMany({
      where: { clientId: cid, isActive: true },
      select: { id: true, network: true, product: true, mode: true, fuelPct: true, fovPct: true, odaFlat: true, odaPerKg: true, cityRates: true, slabs: { select: { id: true } } },
    });
    const shipments = await this.prisma.shipment.findMany({
      where: { clientId: cid }, orderBy: { createdAt: 'desc' }, take: 8,
      select: { awb: true, consigneeCity: true, destZone: true, status: true, statusCode: true, createdAt: true },
    });

    const [shipmentsFY, shipmentsMonth, billedAgg, payAgg] = await Promise.all([
      this.prisma.shipment.count({ where: { clientId: cid, createdAt: { gte: fyStart } } }),
      this.prisma.shipment.count({ where: { clientId: cid, createdAt: { gte: monthStart } } }),
      this.prisma.invoice.aggregate({ _sum: { total: true }, where: { clientId: cid, issuedAt: { gte: fyStart } } }),
      this.prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { clientId: cid, createdAt: { gte: fyStart }, amount: { lt: 0 } } }),
    ]);
    const billedFY = r2n(Number(billedAgg._sum.total ?? 0));
    const collected = r2n(-Number(payAgg._sum.amount ?? 0));

    return {
      client: {
        id: String(client.id), legalName: client.legalName, accountCode: client.accountCode, gstin: client.gstin, pan: client.pan,
        city: client.city, state: client.state, salesPerson: client.salesPerson, isActive: client.isActive, isCreditHold: client.isCreditHold,
        accountType: client.accountType, creditDays: client.creditDays,
      },
      credit: {
        limit: r2n(Number(client.creditLimit)), outstanding: r2n(Number(client.outstandingBal)),
        available: r2n(Number(client.creditLimit) - Number(client.outstandingBal)), overdue: r2n(aging.d1_30 + aging.d31_60 + aging.d61_90 + aging.d90_plus),
        walletBalance: r2n(Number(client.walletBalance)), terms: client.creditDays,
      },
      kpis: { shipmentsFY, shipmentsMonth, billedFY, collected, collectedPct: billedFY > 0 ? Math.min(100, Math.round((collected / billedFY) * 100)) : 0, invoiceCount: invoices.length },
      aging,
      invoices: invRows,
      ledger,
      rateCards: rateCards.map((c) => ({ ...c, slabs: (c.slabs || []).length })),
      shipments,
    };
  }

  /** Customer self-service portal summary — shipment KPIs, 6-month trend, on-time %, invoices,
   *  credit, recent shipments (with POD). Scoped to the logged-in client. */
  /** Accounts a client login may book under: every account in its group — the parent (head
   *  office) plus all child accounts — defined by the explicit parentAccountId link. Includes
   *  shipper-default fields so the booking form can prefill the pickup address. */
  async bookableAccounts(clientId: number) {
    const self = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) }, select: { id: true, parentAccountId: true } });
    if (!self) return [];
    const rootId = self.parentAccountId ?? self.id;
    const rows = await this.prisma.b2bClient.findMany({
      where: { OR: [{ id: rootId }, { parentAccountId: rootId }] },
      orderBy: { accountCode: 'asc' },
    });
    return rows.map((c) => ({
      id: String(c.id),
      accountCode: c.accountCode,
      legalName: c.legalName,
      gstin: c.gstin,
      addressLine: c.addressLine,
      addressLine2: c.addressLine2,
      pincode: c.pincode,
      city: c.city,
      state: c.state ?? c.billingState,
      contactPerson: c.contactPerson ?? c.contactName,
      contactPhone: c.contactPhone,
      contactEmail: c.contactEmail,
    }));
  }

  async clientPortal(clientId: number) {
    const cid = BigInt(clientId);
    const client = await this.prisma.b2bClient.findUnique({ where: { id: cid } });
    if (!client) throw new NotFoundException('Client not found');
    const r2n = (n: number) => +Number(n).toFixed(2);
    const now = Date.now();

    const ships = await this.prisma.shipment.findMany({
      where: { clientId: cid },
      orderBy: { createdAt: 'desc' },
      select: { awb: true, statusCode: true, status: true, createdAt: true, statusAt: true, expectedDelivery: true, consigneeCity: true, destZone: true, podUrl: true, pieceCount: true },
    });
    const total = ships.length;
    const isTerminal = (c: string) => ['DLD', 'RTD', 'CAN'].includes(c);
    const delivered = ships.filter((s) => s.statusCode === 'DLD').length;
    const rto = ships.filter((s) => ['RTO', 'RTD'].includes(String(s.statusCode))).length;
    const cancelled = ships.filter((s) => s.statusCode === 'CAN').length;
    const inTransit = ships.filter((s) => !isTerminal(String(s.statusCode ?? 'MAN'))).length;
    // on-time = delivered within the expected date
    const deliveredWithSla = ships.filter((s) => s.statusCode === 'DLD' && s.expectedDelivery && s.statusAt);
    const onTime = deliveredWithSla.filter((s) => new Date(s.statusAt!).getTime() <= new Date(s.expectedDelivery!).getTime()).length;
    const onTimePct = deliveredWithSla.length ? Math.round((onTime / deliveredWithSla.length) * 100) : null;

    // 6-month booking trend
    const trend: { month: string; count: number }[] = [];
    const d = new Date();
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const next = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
      const label = m.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      const count = ships.filter((s) => { const t = new Date(s.createdAt).getTime(); return t >= m.getTime() && t < next.getTime(); }).length;
      trend.push({ month: label, count });
    }

    // invoices + remaining
    const invoices = await this.prisma.invoice.findMany({ where: { clientId: cid }, orderBy: { issuedAt: 'desc' }, take: 8, select: { id: true, invoiceNo: true, periodStart: true, periodEnd: true, total: true, dueDate: true, status: true } });
    const sums = await this.prisma.ledgerEntry.groupBy({ by: ['invoiceId'], where: { clientId: cid, invoiceId: { not: null } }, _sum: { amount: true } });
    const remMap = new Map(sums.map((s) => [String(s.invoiceId), Number(s._sum.amount ?? 0)]));
    let overdue = 0;
    const invRows = invoices.map((i) => {
      const totalv = Number(i.total);
      const remaining = r2n(remMap.has(String(i.id)) ? Number(remMap.get(String(i.id))) : totalv);
      const daysOverdue = Math.floor((now - new Date(i.dueDate).getTime()) / 86400000);
      const paidStatus = remaining <= 0.01 ? 'PAID' : remaining < totalv - 0.01 ? 'PART-PAID' : daysOverdue > 0 ? 'OVERDUE' : 'OPEN';
      if (remaining > 0.01 && daysOverdue > 0) overdue += remaining;
      return { id: String(i.id), invoiceNo: i.invoiceNo, periodStart: i.periodStart, periodEnd: i.periodEnd, total: totalv, remaining, dueDate: i.dueDate, paidStatus };
    });

    return {
      client: { id: String(client.id), legalName: client.legalName, accountCode: client.accountCode, gstin: client.gstin, city: client.city, state: client.state, accountType: client.accountType },
      credit: { limit: r2n(Number(client.creditLimit)), outstanding: r2n(Number(client.outstandingBal)), available: r2n(Number(client.creditLimit) - Number(client.outstandingBal)), overdue: r2n(overdue), walletBalance: r2n(Number(client.walletBalance)) },
      kpis: { total, delivered, inTransit, rto, cancelled, onTimePct, deliveredPct: total ? Math.round((delivered / total) * 100) : 0 },
      trend,
      invoices: invRows,
      recentShipments: ships.slice(0, 12).map((s) => ({ awb: s.awb, destination: s.consigneeCity ?? s.destZone ?? '—', statusCode: s.statusCode ?? 'MAN', status: s.status, createdAt: s.createdAt, expectedDelivery: s.expectedDelivery, hasPod: !!s.podUrl, pieceCount: s.pieceCount })),
    };
  }
}
