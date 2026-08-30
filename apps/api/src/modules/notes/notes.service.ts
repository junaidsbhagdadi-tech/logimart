import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { gstSplit } from '../../common/gst';

export interface CreateNoteInput {
  clientId: number;
  kind: 'DEBIT' | 'CREDIT';
  reason: string;
  subtotal: number;
  narration?: string;
  shipmentId?: number;
  invoiceId?: number;
  applyGst?: boolean;
  createdById?: number;
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Demurrage / reattempt charge as a DEBIT note (kept OFF the regular freight bill).
   * amount = max(min, days × ratePerKg × chargeable-kg); GST added by create().
   */
  async demurrage(input: { awb: string; firstAttemptDate?: string; days: number; ratePerKg: number; min?: number; createdById?: number }) {
    const awb = String(input.awb || '').trim().toUpperCase();
    const s = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, clientId: true, chargeWeight: true, totalDeadKg: true },
    });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    const kg = Number(s.chargeWeight || s.totalDeadKg || 0) || 1;
    const days = Math.max(0, Math.floor(Number(input.days) || 0));
    const rate = Number(input.ratePerKg) || 0;
    const min = Number(input.min) || 0;
    const subtotal = +Math.max(min, days * rate * kg).toFixed(2);
    if (!(subtotal > 0)) throw new BadRequestException('Demurrage works out to zero — check days / rate / min.');
    const fa = input.firstAttemptDate ? new Date(input.firstAttemptDate).toLocaleDateString('en-GB') : null;
    const narration = `Demurrage — ${days} day(s) × ₹${rate}/kg × ${kg} kg${min ? ` (min ₹${min})` : ''}${fa ? `; first attempt ${fa}` : ''}.`;
    return this.create({ clientId: Number(s.clientId), kind: 'DEBIT', reason: 'demurrage', subtotal, narration, shipmentId: Number(s.id), createdById: input.createdById });
  }

  private async nextNoteNo(kind: 'DEBIT' | 'CREDIT', accountCode: string): Promise<string> {
    const prefix = kind === 'DEBIT' ? 'DN' : 'CN';
    const count = await this.prisma.debitCreditNote.count({ where: { kind } });
    return `${prefix}-${accountCode}-${String(count + 1).padStart(5, '0')}`;
  }

  /**
   * Raise a debit or credit note and post it to the client ledger.
   * DEBIT increases the receivable (like an invoice); CREDIT reduces it (like a payment).
   */
  async create(input: CreateNoteInput) {
    if (!(input.subtotal > 0)) throw new BadRequestException('Amount must be greater than zero.');
    const client = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(input.clientId) } });
    if (!client) throw new NotFoundException('Client not found');

    const split = gstSplit(input.subtotal, client.gstin, client.city, input.applyGst ?? true);
    const noteNo = await this.nextNoteNo(input.kind, client.accountCode);

    const note = await this.prisma.debitCreditNote.create({
      data: {
        noteNo,
        kind: input.kind,
        clientId: client.id,
        shipmentId: input.shipmentId != null ? BigInt(input.shipmentId) : null,
        invoiceId: input.invoiceId != null ? BigInt(input.invoiceId) : null,
        reason: input.reason,
        narration: input.narration,
        subtotal: new Prisma.Decimal(split.subtotal),
        tax: new Prisma.Decimal(split.tax),
        cgst: new Prisma.Decimal(split.cgst),
        sgst: new Prisma.Decimal(split.sgst),
        igst: new Prisma.Decimal(split.igst),
        total: new Prisma.Decimal(split.total),
        createdById: input.createdById != null ? BigInt(input.createdById) : null,
      },
    });

    // Ledger + outstanding: DEBIT adds to receivable, CREDIT reduces it.
    const signed = input.kind === 'DEBIT' ? split.total : -split.total;
    const newBalance = +(Number(client.outstandingBal) + signed).toFixed(2);
    await this.prisma.ledgerEntry.create({
      data: {
        clientId: client.id,
        invoiceId: note.invoiceId,
        entryType: input.kind === 'DEBIT' ? 'debit_note' : 'credit_note',
        amount: new Prisma.Decimal(signed),
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
      message: `${input.kind === 'DEBIT' ? 'Debit' : 'Credit'} note ${noteNo} raised: ₹${split.total} (${input.reason.replace(/_/g, ' ')}).`,
    });

    return { note, newBalance, creditHold: overLimit };
  }

  list(params: { clientId?: number; kind?: string } = {}) {
    return this.prisma.debitCreditNote.findMany({
      where: {
        clientId: params.clientId != null ? BigInt(params.clientId) : undefined,
        kind: params.kind,
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async get(id: number) {
    const note = await this.prisma.debitCreditNote.findUnique({
      where: { id: BigInt(id) },
      include: { client: true, shipment: { select: { awb: true } } },
    });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  /** Reverse a note: back out its ledger impact and mark it cancelled. */
  async cancel(id: number) {
    const note = await this.get(id);
    if (note.status === 'cancelled') return note;
    const client = await this.prisma.b2bClient.findUnique({ where: { id: note.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const reversal = note.kind === 'DEBIT' ? -Number(note.total) : Number(note.total);
    const newBalance = +(Number(client.outstandingBal) + reversal).toFixed(2);
    await this.prisma.ledgerEntry.create({
      data: {
        clientId: client.id,
        invoiceId: note.invoiceId,
        entryType: 'adjustment:note_cancel',
        amount: new Prisma.Decimal(reversal),
        balanceAfter: new Prisma.Decimal(newBalance),
      },
    });
    await this.prisma.b2bClient.update({
      where: { id: client.id },
      data: { outstandingBal: new Prisma.Decimal(newBalance), isCreditHold: newBalance > Number(client.creditLimit) },
    });
    return this.prisma.debitCreditNote.update({ where: { id: note.id }, data: { status: 'cancelled' } });
  }
}
