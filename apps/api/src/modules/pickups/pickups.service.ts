import { Injectable, NotFoundException } from '@nestjs/common';
import { PickupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface CreatePickup {
  clientId: number;
  pickupAddress: string;
  city?: string;
  pincode?: string;
  contactName?: string;
  contactPhone?: string;
  estPieces?: number;
  cargoMode?: string;
  vendor?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  invoiceValue?: number;
  ewbNo?: string;
  notes?: string;
}

@Injectable()
export class PickupsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreatePickup) {
    return this.prisma.pickupRequest.create({
      data: {
        clientId: BigInt(dto.clientId),
        pickupAddress: dto.pickupAddress,
        city: dto.city,
        pincode: dto.pincode,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        estPieces: dto.estPieces ?? 1,
        cargoMode: dto.cargoMode,
        vendor: dto.vendor || null,
        invoiceNo: dto.invoiceNo,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
        invoiceValue: dto.invoiceValue != null ? new Prisma.Decimal(dto.invoiceValue) : null,
        ewbNo: dto.ewbNo,
        notes: dto.notes,
      },
    });
  }

  /** Bulk pickup-request upload. Each row resolves its client by accountCode or internal id (or the
   *  forced clientId for a portal login). Bad rows are reported, good rows imported — the rest continue. */
  async bulkCreate(rows: any[], forcedClientId?: number, vendor?: string) {
    const results: { row: string; ok: boolean; error?: string }[] = [];
    for (const r of rows || []) {
      const label = String(r.pickupAddress ?? r.accountCode ?? r.clientId ?? '(blank)').slice(0, 40);
      try {
        let clientId = forcedClientId;
        if (!clientId) {
          const code = String(r.clientId ?? r.accountCode ?? '').trim();
          if (!code) { results.push({ row: label, ok: false, error: 'clientId / accountCode required' }); continue; }
          const c = await this.prisma.b2bClient.findFirst({
            where: /^\d+$/.test(code) ? { OR: [{ id: BigInt(code) }, { accountCode: { equals: code, mode: 'insensitive' } }] } : { accountCode: { equals: code, mode: 'insensitive' } },
            select: { id: true },
          });
          if (!c) { results.push({ row: label, ok: false, error: `Client "${code}" not found` }); continue; }
          clientId = Number(c.id);
        }
        if (!r.pickupAddress || String(r.pickupAddress).trim().length < 4) { results.push({ row: label, ok: false, error: 'pickupAddress required (min 4 chars)' }); continue; }
        await this.create({
          clientId, pickupAddress: String(r.pickupAddress).trim(), city: r.city, pincode: r.pincode,
          contactName: r.contactName, contactPhone: r.contactPhone,
          estPieces: r.estPieces != null && r.estPieces !== '' ? Number(r.estPieces) : 1,
          // a per-row vendor wins; otherwise the single vendor chosen for the whole upload (blank = none)
          cargoMode: r.cargoMode, vendor: (r.vendor && String(r.vendor).trim()) || vendor || undefined,
          invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate,
          invoiceValue: r.invoiceValue != null && r.invoiceValue !== '' ? Number(r.invoiceValue) : undefined,
          ewbNo: r.ewbNo, notes: r.notes,
        });
        results.push({ row: label, ok: true });
      } catch (e) { results.push({ row: label, ok: false, error: (e as Error).message }); }
    }
    return { total: (rows || []).length, created: results.filter((r) => r.ok).length, results };
  }

  /** Client admins see only their own requests; ops staff see all. */
  list(clientId?: bigint) {
    return this.prisma.pickupRequest.findMany({
      where: clientId != null ? { clientId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async assign(id: number, riderId: number) {
    await this.exists(id);
    return this.prisma.pickupRequest.update({
      where: { id: BigInt(id) },
      data: { assignedRiderId: BigInt(riderId), status: PickupStatus.ASSIGNED },
    });
  }

  async complete(id: number) {
    await this.exists(id);
    return this.prisma.pickupRequest.update({
      where: { id: BigInt(id) },
      data: { status: PickupStatus.PICKED },
    });
  }

  private async exists(id: number) {
    const p = await this.prisma.pickupRequest.findUnique({ where: { id: BigInt(id) } });
    if (!p) throw new NotFoundException('Pickup request not found');
    return p;
  }
}
