/**
 * One-time backfill: recompute every customer's credit-hold flag.
 * A customer should be on hold ONLY while its outstanding balance exceeds its credit limit.
 * Historically isCreditHold was set at invoice/payment time and never re-evaluated when the limit
 * changed, leaving stale holds (e.g. ₹415 outstanding vs a ₹10,00,000 limit).
 *
 * Run on the droplet:
 *   cd /root/logimart/apps/api && \
 *   DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" npx ts-node prisma/fix-credit-holds.ts
 *
 * Add --apply to write changes; without it, it's a dry run that only prints what WOULD change.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const clients = await prisma.b2bClient.findMany({
    select: { id: true, legalName: true, accountCode: true, outstandingBal: true, creditLimit: true, isCreditHold: true },
    orderBy: { legalName: 'asc' },
  });

  const changes: { code: string; name: string; from: boolean; to: boolean; out: number; limit: number }[] = [];
  for (const c of clients) {
    const out = Number(c.outstandingBal);
    const limit = Number(c.creditLimit);
    const shouldHold = out > limit;
    if (shouldHold !== c.isCreditHold) {
      changes.push({ code: c.accountCode, name: c.legalName, from: c.isCreditHold, to: shouldHold, out, limit });
      if (APPLY) {
        await prisma.b2bClient.update({ where: { id: c.id }, data: { isCreditHold: shouldHold } });
      }
    }
  }

  console.log(`\nScanned ${clients.length} customers.`);
  console.log(`${changes.length} need${changes.length === 1 ? 's' : ''} a hold change:\n`);
  for (const ch of changes) {
    console.log(`  ${ch.from ? 'HOLD' : 'OK  '} -> ${ch.to ? 'HOLD' : 'OK  '}  ${ch.code} ${ch.name}  (outstanding ₹${ch.out.toLocaleString('en-IN')} / limit ₹${ch.limit.toLocaleString('en-IN')})`);
  }
  console.log(APPLY ? `\n✓ Applied ${changes.length} update(s).` : `\n(dry run — re-run with --apply to write these changes)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
