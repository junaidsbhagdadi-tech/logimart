/**
 * Read-only rate-selection diagnostic.
 *   npx ts-node prisma/why-rate.ts <awb-or-forwardingAwb>
 *
 * Prints the shipment's pricing-relevant fields, every candidate CustomerRateCard,
 * and reproduces RateService.resolveRateCard's brand-match so you can see exactly
 * which network card the engine picks and WHY. Touches nothing (no writes).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const norm = (s: any) => String(s ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();

async function main() {
  const key = process.argv[2];
  if (!key) { console.error('usage: ts-node prisma/why-rate.ts <awb-or-forwardingAwb>'); process.exit(1); }

  const ship =
    (await prisma.shipment.findUnique({ where: { awb: key } })) ??
    (await prisma.shipment.findFirst({ where: { forwardingAwb: key } })) ??
    (await prisma.shipment.findFirst({ where: { bdWaybill: key } }));
  if (!ship) { console.error(`No shipment found for "${key}" (awb / forwardingAwb / bdWaybill).`); process.exit(2); }

  const client = await prisma.b2bClient.findUnique({ where: { id: ship.clientId } });
  console.log('\n=== SHIPMENT ===');
  console.log({
    awb: ship.awb,
    client: client ? `${client.accountCode} — ${client.legalName}` : ship.clientId.toString(),
    vendor: ship.vendor,               // <-- drives pricing network
    forwardingAwb: ship.forwardingAwb, // <-- carrier AWB (does NOT drive pricing)
    product: ship.product,
    serviceMode: ship.serviceMode,
    originZone: ship.originZone,
    destZone: ship.destZone,
    consigneeCity: ship.consigneeCity,
    manualFreight: ship.manualFreight?.toString() ?? null,
    chargeOverrides: ship.chargeOverrides ?? null,
  });

  const derivedNetwork = !ship.vendor ? 'SELF'
    : String(ship.vendor).toUpperCase().startsWith('BLUEDART') ? 'BLUEDART'
    : String(ship.vendor).toUpperCase();
  console.log(`\nderiveNetwork(shipment) => ${derivedNetwork}`);

  const now = new Date();
  const cards = await prisma.customerRateCard.findMany({
    where: { clientId: ship.clientId, isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
    include: { slabs: true },
  });
  console.log(`\n=== ACTIVE RATE CARDS for this client (${cards.length}) ===`);
  for (const c of cards) console.log(`  network=${String(c.network).padEnd(12)} product=${String(c.product).padEnd(8)} fuelPct=${c.fuelPct?.toString() ?? '-'} id=${c.id}`);

  // --- reproduce resolveRateCard's brand() ---
  const vendors = await prisma.vendor.findMany({ select: { vendorCode: true, name: true } });
  const brand = (s: any): string => {
    const n = norm(s);
    if (!n || n === 'SELF') return n;
    const v = vendors.find((x) => { const cc = norm(x.vendorCode), nm = norm(x.name); return cc === n || nm === n || (cc && n.includes(cc)) || (nm && n.includes(nm)) || (cc && cc.includes(n)); });
    const nameN = v ? norm(v.name) : n;
    if (nameN.includes('BLUEDART') || n.includes('BLUEDART')) return 'BLUEDART';
    return v ? norm(v.vendorCode) : n;
  };

  const prod = String(ship.product ?? '').toUpperCase();
  const byProduct = cards.filter((c) => !prod || String(c.product).toUpperCase() === prod);
  const pool = byProduct.length ? byProduct : cards;
  const shipBrand = brand(ship.vendor);
  console.log(`\nbrand(shipment.vendor="${ship.vendor ?? ''}") => "${shipBrand}"`);
  console.log(`product filter "${prod}" => pool has ${pool.length} card(s)${byProduct.length ? '' : ' (NO product match — fell back to ALL cards)'}`);

  const vendorCard = (shipBrand && shipBrand !== 'SELF') ? pool.find((c) => norm(c.network) !== 'SELF' && brand(c.network) === shipBrand) : undefined;
  const selfCard = pool.find((c) => norm(c.network) === 'SELF');
  const picked = vendorCard || selfCard || pool[0];

  console.log('\n=== RESULT ===');
  if (!picked) { console.log('No card resolved (pool empty).'); }
  else {
    console.log(`PICKED: network=${picked.network} product=${picked.product} id=${picked.id}`);
    if (vendorCard) console.log(`Reason: vendor brand "${shipBrand}" matched this card's network brand.`);
    else if (selfCard) console.log(`Reason: NO card network branded to "${shipBrand}" — fell back to the SELF card.`);
    else console.log('Reason: neither vendor nor SELF matched — used the first card in the pool.');
    if (!vendorCard && shipBrand && shipBrand !== 'SELF') {
      const cand = pool.filter((c) => norm(c.network) !== 'SELF');
      console.log(`\n  ⚠ Vendor cards present but none brand-matched "${shipBrand}":`);
      for (const c of cand) console.log(`     network=${c.network} => brand "${brand(c.network)}"`);
      console.log(`  Fix: either set shipment.vendor to the carrier whose card you want, or align the`);
      console.log(`  card's network string / Vendor master so brand("${ship.vendor}") == brand(card.network).`);
    }
    if (!ship.vendor) {
      console.log(`\n  ⚠ shipment.vendor is EMPTY — the engine can only ever pick the SELF card.`);
      console.log(`  forwardingAwb ("${ship.forwardingAwb ?? ''}") is the carrier AWB and does NOT drive pricing.`);
      console.log(`  Fix: record the carrier in shipment.vendor at hand-off (not just forwardingAwb).`);
    }

    // --- ZONE-SLAB ANALYSIS on the picked card (this is where the ₹/kg comes from) ---
    const slabs: any[] = (picked as any).slabs || [];
    const oz = norm(ship.originZone), dz = norm(ship.destZone);
    const eq = (a: any, b: any) => !a || (b != null && norm(a) === norm(b));
    console.log(`\n=== ZONE-SLAB MATCH on picked card id=${picked.id} (${slabs.length} slabs) ===`);
    console.log(`Shipment lane: origin ${ship.originZone} → dest ${ship.destZone}`);
    // exact filter the engine uses
    const zoneSlabs = slabs.filter((s) => eq(s.zone, ship.destZone) && eq(s.originZone, ship.originZone));
    console.log(`Slabs matching (origin ${ship.originZone} × dest ${ship.destZone}): ${zoneSlabs.length}`);
    if (zoneSlabs.length) {
      for (const s of zoneSlabs) console.log(`   ✅ origin=${s.originZone ?? '∅'} dest=${s.zone ?? '∅'} type=${s.rateType} wt=${s.weight} rate=${s.rate}`);
    } else {
      console.log(`   ⚠ NONE — the engine FALLS BACK to ALL ${slabs.length} slabs and prices from an arbitrary zone (this is the bug you saw).`);
    }
    // what a correct dest-only match would look like
    const destOnly = slabs.filter((s) => norm(s.zone) === dz);
    const originOnly = slabs.filter((s) => norm(s.originZone) === oz);
    console.log(`\nFor reference on this card:`);
    console.log(`  slabs with dest=${ship.destZone} (any origin): ${destOnly.length}${destOnly.length ? ' → ' + destOnly.map((s) => `${s.originZone || '∅'}:${s.rate}`).join(', ') : ''}`);
    console.log(`  slabs with origin=${ship.originZone} (any dest): ${originOnly.length}`);
    const blankOrigin = slabs.filter((s) => !norm(s.originZone)).length;
    const blankDest = slabs.filter((s) => !norm(s.zone)).length;
    console.log(`  slabs with BLANK origin: ${blankOrigin} · BLANK dest: ${blankDest}`);
    const distinctOrigins = [...new Set(slabs.map((s) => s.originZone ?? '∅'))];
    const distinctDests = [...new Set(slabs.map((s) => s.zone ?? '∅'))];
    console.log(`  distinct origins on card: ${distinctOrigins.join(', ')}`);
    console.log(`  distinct dests on card:   ${distinctDests.join(', ')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
