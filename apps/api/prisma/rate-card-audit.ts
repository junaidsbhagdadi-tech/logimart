/**
 * Read-only rate-card health audit across ALL customers/vendors.
 *   npx ts-node prisma/rate-card-audit.ts
 *
 * Flags the two conditions caused by the old "upload creates a duplicate / gets ignored" bug, plus
 * cards that can't price at all. Touches nothing (no writes).
 *   1. DUPLICATE   — more than one active card for the same owner × network × product
 *                    (the rate engine picks the first, silently shadowing the others).
 *   2. UNIFORM     — every zone on a card has the identical freight rate (e.g. flat ₹35 everywhere),
 *                    the tell-tale of an ignored/overwritten upload. May be legitimate — review.
 *   3. NO FREIGHT  — a card with zero freight slabs (can't price a shipment).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FREIGHT = ['PLUSKG', 'UPTO', 'INITIAL', 'ADDITIONAL', 'PLUS', 'FIRST250', 'FIRST500', 'ADD500'];

async function main() {
  const cards = await prisma.customerRateCard.findMany({
    where: { isActive: true },
    include: { slabs: true, client: { select: { accountCode: true, legalName: true } } },
    orderBy: [{ clientId: 'asc' }, { network: 'asc' }, { product: 'asc' }],
  });
  const owner = (c: any) => c.client ? `${c.client.accountCode} — ${c.client.legalName}` : (c.ownerVendorId ? `vendor#${c.ownerVendorId}` : `client#${c.clientId}`);
  const freightSlabs = (c: any) => c.slabs.filter((s: any) => FREIGHT.includes(String(s.rateType).toUpperCase()));

  // ---- 1. duplicates ----
  const groups = new Map<string, any[]>();
  for (const c of cards) {
    const k = `${c.clientId ?? 'V' + c.ownerVendorId}|${String(c.network).toUpperCase()}|${String(c.product).toUpperCase()}`;
    const arr = groups.get(k) ?? []; arr.push(c); groups.set(k, arr);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  console.log(`\n=== 1. DUPLICATE CARDS (same owner × network × product) — ${dupes.length} group(s) ===`);
  if (!dupes.length) console.log('  none ✅');
  for (const g of dupes) {
    console.log(`  ⚠ ${owner(g[0])} · ${g[0].network} · ${g[0].product} → ${g.length} cards (ids ${g.map((c) => c.id).join(', ')})`);
    for (const c of g) console.log(`       id=${c.id}: ${freightSlabs(c).length} freight slabs, rates {${[...new Set(freightSlabs(c).map((s: any) => Number(s.rate)))].join(', ')}}`);
  }

  // ---- 2. uniform cards ----
  const uniform = cards.filter((c) => { const f = freightSlabs(c); return f.length >= 2 && new Set(f.map((s: any) => Number(s.rate))).size === 1; });
  console.log(`\n=== 2. UNIFORM CARDS (every zone the SAME rate — likely an ignored upload) — ${uniform.length} ===`);
  if (!uniform.length) console.log('  none ✅');
  for (const c of uniform) console.log(`  ⚠ ${owner(c)} · ${c.network} · ${c.product} (id=${c.id}) — all ${freightSlabs(c).length} zones = ₹${Number(freightSlabs(c)[0].rate)}`);

  // ---- 3. cards that can't price ----
  const empty = cards.filter((c) => freightSlabs(c).length === 0);
  console.log(`\n=== 3. CARDS WITH NO FREIGHT SLABS (can't price) — ${empty.length} ===`);
  if (!empty.length) console.log('  none ✅');
  for (const c of empty) console.log(`  ⚠ ${owner(c)} · ${c.network} · ${c.product} (id=${c.id})`);

  const affected = new Set<any>();
  dupes.flat().forEach((c) => affected.add(c.id));
  uniform.forEach((c) => affected.add(c.id));
  empty.forEach((c) => affected.add(c.id));
  console.log(`\n=== SUMMARY ===`);
  console.log(`  ${cards.length} active cards · ${dupes.length} duplicate groups · ${uniform.length} uniform · ${empty.length} empty`);
  console.log(`  → ${affected.size} card(s) to review / re-upload.`);
  if (dupes.length) console.log(`  Note: re-uploading a customer's sheet (post-fix) overwrites & collapses their duplicates automatically.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
