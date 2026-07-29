import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  createLead(dto: any) {
    return this.prisma.lead.create({
      data: {
        companyName: dto.companyName,
        contactName: dto.contactName,
        phone: dto.phone,
        email: dto.email,
        salesperson: dto.salesperson,
        services: Array.isArray(dto.services) ? dto.services.join(',') : dto.services,
        stage: (dto.stage as LeadStage) ?? LeadStage.NEW,
        potentialVolume: dto.potentialVolume,
        potentialRevenue: dto.potentialRevenue != null ? new Prisma.Decimal(dto.potentialRevenue) : null,
        nextFollowup: dto.nextFollowup ? new Date(dto.nextFollowup) : null,
        notes: dto.notes,
      },
    });
  }

  listLeads() {
    return this.prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, include: { quotations: true } });
  }

  async updateLead(id: number, dto: any) {
    await this.exists(id);
    return this.prisma.lead.update({
      where: { id: BigInt(id) },
      data: {
        stage: dto.stage as LeadStage | undefined,
        salesperson: dto.salesperson,
        nextFollowup: dto.nextFollowup ? new Date(dto.nextFollowup) : undefined,
        notes: dto.notes,
        potentialRevenue: dto.potentialRevenue != null ? new Prisma.Decimal(dto.potentialRevenue) : undefined,
      },
    });
  }

  addQuotation(leadId: number, dto: any) {
    return this.prisma.quotation.create({
      data: {
        leadId: BigInt(leadId),
        service: dto.service,
        lane: dto.lane,
        amount: new Prisma.Decimal(dto.amount),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes,
      },
    });
  }

  /** Pipeline summary for the CRM dashboard. */
  async pipeline() {
    const grouped = await this.prisma.lead.groupBy({ by: ['stage'], _count: { _all: true }, _sum: { potentialRevenue: true } });
    return grouped.map((g) => ({ stage: g.stage, count: g._count._all, potentialRevenue: g._sum.potentialRevenue }));
  }

  private async exists(id: number) {
    const l = await this.prisma.lead.findUnique({ where: { id: BigInt(id) } });
    if (!l) throw new NotFoundException('Lead not found');
    return l;
  }
}
