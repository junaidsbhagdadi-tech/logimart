import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ExpenseInput {
  date?: string; mode?: string; category?: string; remark?: string;
  amount: number; companyAmount?: number; paidBy?: string; paidTo?: string; branch?: string; createdById?: number;
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: ExpenseInput) {
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
        createdById: dto.createdById != null ? BigInt(dto.createdById) : null,
      },
    });
  }

  async list(q: { from?: string; to?: string; branch?: string; category?: string }) {
    const where: any = {};
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to + 'T23:59:59') } : {}) };
    if (q.branch) where.branch = q.branch;
    if (q.category) where.category = q.category;
    const rows = await this.prisma.expense.findMany({ where, orderBy: { date: 'desc' }, take: 5000 });
    const byCategory: Record<string, number> = {};
    const byBranch: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const a = Number(r.amount); total += a;
      byCategory[r.category] = +((byCategory[r.category] || 0) + a).toFixed(2);
      if (r.branch) byBranch[r.branch] = +((byBranch[r.branch] || 0) + a).toFixed(2);
    }
    return { count: rows.length, total: +total.toFixed(2), byCategory, byBranch, rows };
  }

  async remove(id: number) {
    await this.prisma.expense.delete({ where: { id: BigInt(id) } });
    return { ok: true };
  }
}
