#!/usr/bin/env node
/**
 * DEMO build rebrand — rewrites the BUILT output (apps/web/dist + apps/api/dist) of a demo checkout so no
 * real company, carrier, customer, address, GSTIN, bank or phone survives, then scans for leftovers and
 * exits 1 if any remain. Source code is never touched; run only inside the demo copy:
 *   node scripts/demo/rebrand.mjs /root/demo-erp
 *
 * Replacements are identifier-safe (no spaces inside a word that is also a code identifier) and applied
 * in BOTH bundles, so web ↔ API strings stay consistent. Lower-case tokens are left alone in code because
 * they are module paths / routes (e.g. ./modules/bluedart/…) — those are internal, never shown.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const PRODUCT = 'TransitOne'; // the software name shown in the demo (was the operator's brand)

// Order matters: longest / most specific first.
const MAP = [
  // operator entity, addresses, tax + bank identifiers
  [/EXCELEX EXPRESS LOGISTICS LLP/g, 'NORTHWIND EXPRESS PRIVATE LIMITED'],
  [/Ex[cC]el[eE]x Express Logistics LLP/g, 'Northwind Express Private Limited'],
  [/Ex[cC]el[eE]x Express · Logistics LLP/g, 'Northwind Express'],
  [/Ex[cC]el[eE]x Express/g, 'Northwind Express'],
  [/Ex[cC]el[eE]x Delivery/g, 'Northwind Delivery'],
  [/Ex[cC]el[eE]x Rider/g, 'Northwind Rider'],
  [/Ex[cC]el[eE]x Group/g, 'Northwind Group'],
  [/Excelex EX/g, 'Northwind'],
  [/excelexlog\.com/g, 'northwind.example'],
  [/EXCELEX/g, 'NORTHWIND'], [/ExcelEx/g, 'Northwind'], [/Excelex/g, 'Northwind'],
  [/LOGISTICS LLP/g, 'LOGISTICS'],
  [/logimart\.co\.in/g, 'northwind.example'],
  [/LOGIMART TECHNOLOGIES PRIVATE LIMITED/g, 'NORTHWIND EXPRESS PRIVATE LIMITED'],
  [/LogiMart ERP|Logimart ERP|LOGIMART ERP/g, `${PRODUCT} ERP`],
  [/LOGIMART/g, PRODUCT.toUpperCase()], [/LogiMart/g, PRODUCT], [/Logimart/g, PRODUCT],
  // the login page's prefilled demo account → the demo admin
  [/client@demo\.com/g, 'admin@northwind.example'], [/logimart1234/g, 'Demo@123'],
  // lower-case brand tokens (storage keys, file names, CSS classes, health id) — no module path uses them
  [/logimart/g, PRODUCT.toLowerCase()], [/excelex/g, 'northwind'],
  // the Carrier APIs page address (web route literal only; API paths keep their internal names)
  [/(["'`])\/bluedart(["'`])/g, '$1/carrier-apis$2'],
  [/Office No\. 27\/2, Road No\. 2, Block A, Near Aeroporto Hotel,?/g, 'Unit 4, Logistics Park, Sector 7,'],
  [/84 B-1, Main Vasant Kunj Road, Mahipalpur, New Delhi-110037/g, 'Dwarka, New Delhi'],
  [/Mahipalpur, New Delhi - 110037/g, 'Dwarka, New Delhi - 110075'],
  [/Mahipalpur/g, 'Dwarka'], [/Aeroporto/g, 'Logistics Park'],
  [/07AAIFE6185E1ZC/g, '07AAACN1234Q1Z5'], [/AAIFE6185E/g, 'AAACN1234Q'], [/AAU-3745/g, 'AAA-0000'],
  [/347405000806/g, '000123456789'], [/ICIC0003474/g, 'DEMO0001234'], [/ICICI BANK/g, 'DEMO BANK'],
  [/011-71859599/g, '011-40000000'], [/9967673566/g, '9000000000'],
  [/Tuvas Logistics And Warehousing LLP|TUVAS LOGISTICS AND WAREHOUSING LLP/g, 'Northwind Partner Account'],
  [/Tuvas/g, 'Partner'], [/TUVAS/g, 'PARTNER'],
  [/Urbanebolt|UrbaneBolt|URBANEBOLT|Urbanlogix|URBANLOGIX/g, 'Northwind'],
  [/eShipz/g, 'ShipHub'],
  // carriers → fictional carriers
  [/BLUE DART EXP(RESS)? LTD/g, 'SKYLINE AIR EXPRESS'],
  [/Blue Dart/g, 'SkyLine'], [/BLUE DART/g, 'SKYLINE'], [/BlueDart/g, 'SkyLine'], [/Bluedart/g, 'Skyline'], [/BLUEDART/g, 'SKYLINE'],
  [/Delhivery/g, 'Roadway'], [/DELHIVERY/g, 'ROADWAY'],
  [/Xpress ?Bees/g, 'ParcelJet'], [/XPRESS ?BEES/g, 'PARCELJET'], [/XpressBees/g, 'ParcelJet'],
  [/Allcargo/g, 'Meridian'], [/ALLCARGO/g, 'MERIDIAN'], [/\bGati\b/g, 'Meridian'], [/\bGATI\b/g, 'MERIDIAN'],
  [/V Express/g, 'Vertex Express'], [/V EXPRESS/g, 'VERTEX EXPRESS'], [/VExpress/g, 'Vertex'], [/Velocia/g, 'Vertex'], [/VELOCIA/g, 'VERTEX'],
  [/DS Cargo/g, 'Dune Cargo'], [/DS CARGO/g, 'DUNE CARGO'], [/DsCargo/g, 'DuneCargo'],
  [/AR Logistics/g, 'Aster Logistics'], [/AR LOGISTICS/g, 'ASTER LOGISTICS'],
  [/DTDC/g, 'PRIME'],
];

// Anything matching these after the rewrite = a leak (case-insensitive). Lower-case module paths / routes
// (bluedart/, delhivery/, gati/ …) are internal and allowed only in the API bundle's require() paths.
const LEAKS = [/logimart/i, /excelex/i, /blue ?dart/i, /delhivery/i, /xpress ?bees/i, /allcargo/i, /\bgati\b/i, /velocia/i, /\bv express\b/i, /\bds cargo\b/i,
  /tuvas/i, /urbanebolt/i, /urbanlogix/i, /07AAIFE6185E1ZC/, /347405000806/, /9967673566/, /71859599/, /mahipalpur/i, /aeroporto/i, /\bdtdc\b/i, /eshipz/i];
const ALLOWED = [/\b(bluedart|delhivery|xpressbees|dscargo|gati|vexpress|arl)_[a-z_]*\d*\b/g, /require\(["'][^"']*["']\)/g, /["']\.\/[a-z0-9/._-]+["']/g, /api\/v1\/[a-z0-9/_:-]+/g, /["']\/(bluedart|delhivery|gati|xpressbees|dscargo)[a-z0-9/_:-]*["']/g, /\b(bluedart|delhivery|xpressbees|dscargo|gati)[A-Za-z]*\b/g];

const files = [];
const walk = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (/\.(js|mjs|cjs|html|css|json|webmanifest|txt)$/.test(f) && !/\.map$/.test(f)) files.push(p); } };
walk(path.join(ROOT, 'apps/web/dist'));
walk(path.join(ROOT, 'apps/api/dist'));
if (!files.length) { console.error('No built files found — build web + api first.'); process.exit(1); }

// Source maps would re-expose the original strings — drop them.
const dropMaps = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) dropMaps(p); else if (f.endsWith('.map')) fs.unlinkSync(p); } };
dropMaps(path.join(ROOT, 'apps/web/dist')); dropMaps(path.join(ROOT, 'apps/api/dist'));
// The operator's logo image + rider-app preview page never ship in the demo (the text logo takes over).
for (const f of ['apps/web/dist/logo.png', 'apps/web/dist/rider-preview.html']) { const p = path.join(ROOT, f); if (fs.existsSync(p)) fs.unlinkSync(p); }

// Web bundle only: lower-case carrier words that a user can see (page anchors, download names) — never
// inside an /api/v1/... address, which must keep matching the API's routes.
const API = '(?<!/api/v1/(?:[a-z0-9-]+/)*)';
const WEB_MAP = [['bluedart', 'skyline'], ['delhivery', 'roadway'], ['xpressbees', 'parceljet'], ['dscargo', 'dunecargo'], ['gati', 'meridian']]
  .map(([a, b]) => [new RegExp(API + '\\b' + a + '\\b', 'g'), b]);

let changed = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const before = fs.readFileSync(f, 'utf8');
  let s = before;
  for (const [re, to] of MAP) s = s.replace(re, to);
  if (f.includes(`${path.sep}web${path.sep}`)) for (const [re, to] of WEB_MAP) s = s.replace(re, to);
  if (s !== before) { fs.writeFileSync(f, s); changed++; }
}
console.log(`rebranded ${changed}/${files.length} files`);

// Leak scan
const hits = [];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let s = fs.readFileSync(f, 'utf8');
  for (const re of ALLOWED) s = s.replace(re, '');
  for (const re of LEAKS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m; while ((m = g.exec(s)) && hits.length < 60) hits.push(`${path.relative(ROOT, f)}: …${s.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ')}…`);
  }
}
if (hits.length) { console.error(`LEAK CHECK FAILED — ${hits.length} hit(s):\n` + hits.join('\n')); process.exit(1); }
console.log('leak check passed — no real names, addresses, GSTIN, bank or phone numbers in the demo build');
