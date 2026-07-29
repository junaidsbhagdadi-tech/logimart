import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';

export interface CreateClaimInput {
  awb?: string;
  clientId?: number;
  type: 'damage' | 'loss' | 'shortage' | 'delay';
  claimedAmount: number;
  declaredValue?: number;
  description?: string;
  createdById?: number;
}

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: NotesService,
  ) {}

  private async nextClaimNo(): Promise<string> {
    const count = await this.prisma.claim.count();
    const year = new Date().getFullYear();
    return `CLM-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(input: CreateClaimInput) {
    let clientId = input.clientId != null ? BigInt(input.clientId) : undefined;
    let shipmentId: bigint | undefined;
    let declaredValue = input.declaredValue;

    if (input.awb) {
      const s = await this.prisma.shipment.findUnique({ where: { awb: input.awb }, select: { id: true, clientId: true, declaredValue: true } });
      if (!s) throw new NotFoundException(`AWB ${input.awb} not found`);
      shipmentId = s.id;
      clientId = s.clientId;
      if (declaredValue == null && s.declaredValue != null) declaredValue = Number(s.declaredValue);
    }
    if (clientId == null) throw new BadRequestException('A client (or an AWB) is required to raise a claim.');

    const claimNo = await this.nextClaimNo();
    return this.prisma.claim.create({
      data: {
        claimNo,
        clientId,
        shipmentId,
        awb: input.awb,
        type: input.type,
        declaredValue: declaredValue != null ? new Prisma.Decimal(declaredValue) : null,
        claimedAmount: new Prisma.Decimal(input.claimedAmount),
        description: input.description,
        createdById: input.createdById != null ? BigInt(input.createdById) : null,
      },
    });
  }

  list(status?: string) {
    return this.prisma.claim.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async get(id: number) {
    const c = await this.prisma.claim.findUnique({ where: { id: BigInt(id) } });
    if (!c) throw new NotFoundException('Claim not found');
    return c;
  }

  /** Move a claim through review; no financial impact. */
  async review(id: number, status: 'under_review' | 'rejected', resolution?: string) {
    await this.get(id);
    return this.prisma.claim.update({
      where: { id: BigInt(id) },
      data: { status, resolution, resolvedAt: status === 'rejected' ? new Date() : null },
    });
  }

  /**
   * Approve & settle a claim: records the approved amount and raises a CREDIT note
   * to the client for that amount (compensation — non-taxable, so no GST).
   */
  async settle(id: number, approvedAmount: number, resolution?: string) {
    const claim = await this.get(id);
    if (claim.status === 'settled') throw new BadRequestException('Claim already settled.');
    if (!(approvedAmount > 0)) throw new BadRequestException('Approved amount must be greater than zero.');

    const { note } = await this.notes.create({
      clientId: Number(claim.clientId),
      kind: 'CREDIT',
      reason: 'damage_claim',
      subtotal: approvedAmount,
      applyGst: false,
      narration: `Claim ${claim.claimNo} (${claim.type})${claim.awb ? ' — ' + claim.awb : ''} settlement`,
      shipmentId: claim.shipmentId != null ? Number(claim.shipmentId) : undefined,
    });

    return this.prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: 'settled',
        approvedAmount: new Prisma.Decimal(approvedAmount),
        resolution: resolution ?? `Settled via credit note ${note.noteNo}`,
        noteId: note.id,
        resolvedAt: new Date(),
      },
    });
  }
}
