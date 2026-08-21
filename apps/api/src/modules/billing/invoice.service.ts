import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RateService } from './rate.service';

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
      disputeReason: string | null;
    }[] = [];
    let subtotal = 0;

    for (const s of shipments) {
      if (alreadyBilled.has(s.id.toString())) continue; // already invoiced
      const delivered = s.pieces.filter((p) => p.status === 'DELIVERED');
      if (delivered.length === 0) continue; // nothing billable yet
      const charges = await this.rates.chargesForShipment(s, delivered);
      if (!charges) continue; // no rate configured -> skip

      const chargeableKg = charges.chargeableKg;
      const amount = charges.subtotal; // freight + surcharges (or FTL/manual), pre-GST
      const isShort = delivered.length < s.pieceCount;
      lines.push({
        shipmentId: s.id,
        chargeableKg,
        amount,
        disputeReason: isShort
          ? `structural_review: short delivery, billed ${delivered.length}/${s.pieceCount} boxes`
          : null,
      });
      subtotal += amount;
    }

    if (lines.length === 0) {
      throw new BadRequestException('No billable (delivered) shipments in this period.');
    }

    const tax = +(subtotal * GST_RATE).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);

    // Place of supply → CGST+SGST (intra-state) vs IGST (inter-state).
    const carrierState = process.env.COMPANY_STATE_CODE ?? '29'; // Karnataka
    const clientState = client.gstin && client.gstin.length >= 2 ? client.gstin.slice(0, 2) : null;
    const intraState = clientState ? clientState === carrierState : true;
    const cgst = intraState ? +(tax / 2).toFixed(2) : 0;
    const sgst = intraState ? +(tax / 2).toFixed(2) : 0;
    const igst = intraState ? 0 : tax;
    const placeOfSupply = stateName(clientState) ?? client.city ?? stateName(carrierState) ?? 'Karnataka';

    const invoiceNo = `INV-${client.accountCode}-${new Date(periodEnd).toISOString().slice(0, 7)}-${Date.now()
      .toString()
      .slice(-5)}`;
    const dueDate = new Date(new Date(periodEnd).getTime() + client.creditDays * 86400000);

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
        status: InvoiceStatus.ISSUED,
        dueDate,
        issuedAt: new Date(),
        lines: {
          create: lines.map((l) => ({
            shipmentId: l.shipmentId,
            chargeableKg: new Prisma.Decimal(l.chargeableKg),
            amount: new Prisma.Decimal(l.amount),
            disputeReason: l.disputeReason,
          })),
        },
      },
      include: { lines: true },
    });

    // Ledger charge + credit exposure
    const newBalance = +(Number(client.outstandingBal) + total).toFixed(2);
    await this.prisma.ledgerEntry.create({
      data: {
        clientId: client.id,
        invoiceId: invoice.id,
        entryType: 'charge',
        amount: new Prisma.Decimal(total),
        balanceAfter: new Prisma.Decimal(newBalance),
      },
    });
    const overLimit = newBalance > Number(client.creditLimit);
    await this.prisma.b2bClient.update({
      where: { id: client.id },
      data: { outstandingBal: new Prisma.Decimal(newBalance), isCreditHold: overLimit },
    });

    await this.notifications.notify({
      channel: 'email',
      recipient: client.accountCode,
      kind: 'invoice',
      message: `Invoice ${invoice.invoiceNo} issued: ₹${total} due ${dueDate.toISOString().slice(0, 10)}${overLimit ? ' — ACCOUNT ON CREDIT HOLD' : ''}.`,
    });

    return { invoice, creditHold: overLimit, newBalance, creditLimit: client.creditLimit };
  }

  /**
   * Bill-working export — one row per AWB with every charge head, matching the
   * "Customer bill working" sheet columns exactly (59 cols). Charges come from the
   * live rate engine; unrated AWBs show zeros.
   */
  async billWorksheet(clientId: number, from?: string, to?: string) {
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(clientId) } });
    if (!client) throw new NotFoundException('Client not found');
    const where: any = { clientId: client.id };
    if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const shipments = await this.prisma.shipment.findMany({
      where, orderBy: { createdAt: 'asc' }, take: 5000,
      include: { pieces: { select: { status: true, deadKg: true, volKg: true, lengthCm: true, widthCm: true, heightCm: true } } },
    });

    const carrierState = process.env.COMPANY_STATE_CODE ?? '29';
    const clientState = client.gstin && client.gstin.length >= 2 ? client.gstin.slice(0, 2) : null;
    const intraState = clientState ? clientState === carrierState : true;
    const vendorCode = (v?: string | null) => (v && String(v).toUpperCase().startsWith('BLUEDART') ? 'BDR' : (v || 'SELF'));
    const d10 = (dt: any) => (dt ? new Date(dt).toISOString().slice(0, 10) : '');

    const rows: Record<string, any>[] = [];
    for (const s of shipments) {
      const b: any = (await this.rates.chargesForShipment(s, s.pieces)) || {};
      const num = (x: any) => +(Number(x ?? 0)).toFixed(2);
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
        'FREIGHT ON VALUE': num(b.fov), 'OVER SIZE PCS': num(b.osp), 'PICKUP CHARGES': 0, 'TOPAY CHARGES': num(b.topay),
        'VALUABLE CARGO HANDLING CHARGE': num(b.handling), 'CHEQUE/DD ON DELIVERY': 0, 'APPOINTMENT DELIVERY': num(b.appt),
        'Packaging charges': 0, 'Pikcup charges': 0, 'Reverse pick up ( Topay)': 0, 'DEMMURAGE CHARGE': 0,
        'Other Charges 1': num(b.loading), 'Other Charges 2': num(b.unloading), 'RAS CHARGE': 0, 'Currency Adjustment': 0,
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
        include: { pieces: true, client: { select: { legalName: true, accountCode: true } } },
      });
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
        lines: { include: { shipment: { select: { awb: true, originZone: true, destZone: true } } } },
        client: {
          select: {
            legalName: true, accountCode: true, gstin: true,
            addressLine: true, city: true, pincode: true,
          },
        },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
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
}
