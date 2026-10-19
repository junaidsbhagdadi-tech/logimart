import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface ExpenseInput {
  date?: string; mode?: string; category?: string; remark?: string;
  amount: number; companyAmount?: number; paidBy?: string; paidTo?: string; branch?: string; createdById?: number;
  attachment?: string; // base64 data URI of the bill/receipt (offloaded to Spaces on write)
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async create(dto: ExpenseInput) {
    // Offload the bill/receipt image to object storage (falls back to inline on a bare deploy).
    const attachmentUrl = dto.attachment ? await this.storage.store(dto.attachment, 'expense') : null;
    return this.prisma.expense.create({
      data: {
        date: dto.date ? new Date(dto.date) : new Date(),
        mode: String(dto.mode || 'CASH'),
        category: String(dto.category || 'Other'),
        remark: dto.remark?.trim() || null,
        amount: new Prisma.Decimal(Number(dto.amount) || 0),
        companyAmount: dto.companyAmount != null && String(dto.companyAmount) !== '' ? new Prisma.Decimal(Number(dto.companyAmount) || 0) : null,
        paidBy: dto.paidBy?.trim() || null,
        paidTo: dto.paidTo?.trim() || null,
        branch: dto.branch?.trim() || null,
        attachmentUrl: attachmentUrl || null,
        createdById: dto.createdById != null ? BigInt(dto.createdById) : null,
      },
    });
  }

  async list(q: { from?: string; to?: string; branch?: string; category?: string; branches?: string[] | null }) {
    const where: any = {};
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to + 'T23:59:59') } : {}) };
    if (q.branch) where.branch = q.branch;
    if (q.category) where.category = q.category;
    // #10 — a branch-scoped user only sees their branches' expenses (branch is free text → match case-insensitively).
    const branchScope = q.branches ? { OR: q.branches.map((b) => ({ branch: { equals: b, mode: 'insensitive' as const } })) } : null;
    if (branchScope) where.AND = [branchScope];
    const raw = await this.prisma.expense.findMany({ where, orderBy: { date: 'desc' }, take: 5000 });
    // Turn stored attachment keys into short-lived loadable URLs for the browser.
    const rows = await Promise.all(raw.map(async (r) => ({ ...r, attachmentUrl: await this.storage.resolve(r.attachmentUrl) })));
    const byCategory: Record<string, number> = {};
    const byBranch: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const a = Number(r.amount); total += a;
      byCategory[r.category] = +((byCategory[r.category] || 0) + a).toFixed(2);
      if (r.branch) byBranch[r.branch] = +((byBranch[r.branch] || 0) + a).toFixed(2);
    }
    // All-time available balance per branch = Σ company-funded − Σ spent (float remaining, not date-scoped).
    const grouped = await this.prisma.expense.groupBy({ by: ['branch'], where: branchScope ?? undefined, _sum: { amount: true, companyAmount: true } });
    const balanceByBranch: Record<string, { funded: number; spent: number; balance: number }> = {};
    for (const g of grouped) {
      if (!g.branch) continue;
      const funded = Number(g._sum.companyAmount ?? 0), spent = Number(g._sum.amount ?? 0);
      balanceByBranch[g.branch] = { funded: +funded.toFixed(2), spent: +spent.toFixed(2), balance: +(funded - spent).toFixed(2) };
    }
    return { count: rows.length, total: +total.toFixed(2), byCategory, byBranch, balanceByBranch, rows };
  }

  async remove(id: number) {
    await this.prisma.expense.delete({ where: { id: BigInt(id) } });
    return { ok: true };
  }
}
