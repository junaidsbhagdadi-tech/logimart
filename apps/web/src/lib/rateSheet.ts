import * as XLSX from 'xlsx';

export type ParsedSlab = { originZone: string; zone: string; rateType: string; weight: number; rate: number };
export type ParseResult = {
  family: 'CARGO' | 'COURIER' | 'UNKNOWN';
  slabs: ParsedSlab[];
  origins: string[];
  dests: string[];
  notes: string[];
};

// Cargo (Apex/Surface) zones vs courier (DP/TDD/NDD) zones.
const CARGO_ZONE = /^(N[1-4]|NE[1-3]|C[1-2]|W[1-3]|S[1-3]|E[1-3])$/i;

// The 18 transit zones, ordered as in the TAT sheet.
export const TAT_ZONES = ['N1', 'N2', 'N3', 'N4', 'C1', 'C2', 'W1', 'W2', 'W3', 'S1', 'S2', 'S3', 'E1', 'E2', 'E3', 'NE1', 'NE2', 'NE3'];

/**
 * Parse a Transit-TAT workbook (one sheet per mode: SURFACE, APEX/AIR) into
 * { MODE: { originZone: { destZone: days } } }. Robust to cell offset — finds each
 * sheet's zone header row and the origin column, then reads the day matrix.
 */
export async function parseTatWorkbook(file: File): Promise<Record<string, Record<string, Record<string, number>>>> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const name of wb.SheetNames) {
    const raw = name.trim().toUpperCase();
    const mode = raw === 'AIR' ? 'APEX' : raw;
    if (mode !== 'SURFACE' && mode !== 'APEX') continue;
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: true, blankrows: false });
    let hdrRow = -1, hdrScore = -1;
    rows.forEach((r, i) => { const s = (r || []).filter((v) => CARGO_ZONE.test(String(v ?? '').trim())).length; if (s > hdrScore) { hdrScore = s; hdrRow = i; } });
    if (hdrRow < 0) continue;
    const hdr = (rows[hdrRow] || []).map((v) => String(v ?? '').trim().toUpperCase());
    const destCols: { idx: number; zone: string }[] = [];
    hdr.forEach((v, idx) => { if (CARGO_ZONE.test(v)) destCols.push({ idx, zone: v }); });
    if (!destCols.length) continue;
    const firstDest = destCols[0].idx;
    const matrix: Record<string, Record<string, number>> = {};
    for (let i = hdrRow + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      let origin = '';
      for (let c = 0; c < firstDest; c++) { const v = String(r[c] ?? '').trim().toUpperCase(); if (CARGO_ZONE.test(v)) { origin = v; break; } }
      if (!origin) continue;
      matrix[origin] = {};
      for (const d of destCols) { const n = num(r[d.idx]); if (n > 0) matrix[origin][d.zone] = n; }
      // Same origin=dest is always 1 day (source sheets sometimes leave the diagonal blank/typo'd).
      if (!(matrix[origin][origin] > 0)) matrix[origin][origin] = 1;
    }
    out[mode] = matrix;
  }
  return out;
}
const COURIER_ZONE = /^(A|B|C|OTHER)$/i;

const num = (v: any): number => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

/**
 * Parse a filled rate matrix into origin×dest slabs. Robust to cell position:
 * it finds the header row (most zone-code cells) and the origin column, then reads
 * the rectangular rate block between them. CARGO = one ₹/kg rate per cell (PLUSKG).
 * COURIER layout (250/500g × A/B/C/OTHER) is detected but not yet parsed — pending a sample.
 */
export async function parseRateWorkbook(file: File, family: 'CARGO' | 'COURIER'): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ZONE = family === 'COURIER' ? COURIER_ZONE : CARGO_ZONE;
  const notes: string[] = [];

  // pick the sheet with the most zone-code cells
  let best: any[][] = [];
  let bestScore = -1;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: true, blankrows: false });
    const score = rows.reduce((s, r) => s + (r || []).filter((v) => ZONE.test(String(v ?? '').trim())).length, 0);
    if (score > bestScore) { bestScore = score; best = rows; }
  }
  if (bestScore <= 0) return { family: 'UNKNOWN', slabs: [], origins: [], dests: [], notes: ['No zone codes found in the sheet.'] };

  // header row = the row with the most zone-code cells (these are the destination zones)
  let hdrRow = -1;
  let hdr: { zone: string; col: number }[] = [];
  best.forEach((r, ri) => {
    const cells = (r || []).map((v, ci) => ({ v: String(v ?? '').trim(), ci })).filter((x) => ZONE.test(x.v));
    if (cells.length > hdr.length) { hdr = cells.map((x) => ({ zone: x.v.toUpperCase(), col: x.ci })); hdrRow = ri; }
  });
  const minHdrCol = Math.min(...hdr.map((h) => h.col));

  // origin column = the column left of the header holding zone codes down the rows
  let originCol = -1;
  let originBest = 0;
  for (let c = 0; c < minHdrCol; c++) {
    let cnt = 0;
    for (let r = hdrRow + 1; r < best.length; r++) if (ZONE.test(String(best[r]?.[c] ?? '').trim())) cnt++;
    if (cnt > originBest) { originBest = cnt; originCol = c; }
  }

  const slabs: ParsedSlab[] = [];
  const origins = new Set<string>();
  const dests = new Set<string>();

  if (family === 'COURIER') {
    // Layout: col A = weight slab (FIRST 250 GM / FIRST 500 GM / EVERY ADD 500 GM),
    // col B = origin zone (A/B/C/OTHER, one label per 3-row block), cols C.. = dest zones.
    const slabOf = (t: string): [string, number] | null => {
      const s = String(t).toUpperCase();
      if (/250/.test(s)) return ['FIRST250', 0.25];
      if (/500/.test(s) && /(ADD|EVERY)/.test(s)) return ['ADD500', 0.5];
      if (/500/.test(s)) return ['FIRST500', 0.5];
      return null;
    };
    // slab column = the one (left of dests) holding FIRST/ADD text
    let slabCol = -1;
    for (let c = 0; c < minHdrCol && slabCol < 0; c++) {
      for (let r = hdrRow + 1; r < best.length; r++) if (slabOf(String(best[r]?.[c] ?? ''))) { slabCol = c; break; }
    }
    // Blank separator rows get stripped by the reader, so delimit each origin block by its
    // base slab (FIRST 250, else FIRST 500) — a new base row starts a new origin block.
    const dataRows: { r: number; sw: [string, number] }[] = [];
    for (let r = hdrRow + 1; r < best.length; r++) { const sw = slabOf(String(best[r]?.[slabCol] ?? '')); if (sw) dataRows.push({ r, sw }); }
    const baseType = dataRows.some((d) => d.sw[0] === 'FIRST250') ? 'FIRST250' : 'FIRST500';
    const blocks: { r: number; sw: [string, number] }[][] = [];
    let cur: { r: number; sw: [string, number] }[] | null = null;
    for (const d of dataRows) {
      if (d.sw[0] === baseType) { if (cur) blocks.push(cur); cur = [d]; }
      else if (cur) cur.push(d);
      else cur = [d];
    }
    if (cur) blocks.push(cur);
    for (const blk of blocks) {
      let origin: string | null = null;
      for (const d of blk) { const oz = String(best[d.r]?.[originCol] ?? '').trim().toUpperCase(); if (COURIER_ZONE.test(oz)) { origin = oz; break; } }
      if (!origin) continue;
      origins.add(origin);
      for (const d of blk) {
        const [rateType, weight] = d.sw;
        for (const h of hdr) {
          const rate = num(best[d.r]?.[h.col]);
          if (rate > 0) { slabs.push({ originZone: origin, zone: h.zone, rateType, weight, rate }); dests.add(h.zone); }
        }
      }
    }
    if (!slabs.length) notes.push('Courier axes found but no rates in the grid — is the template filled?');
    return { family, slabs, origins: [...origins], dests: [...dests], notes };
  }

  // CARGO: one ₹/kg rate per origin×dest cell → PLUSKG weight 1
  for (let r = hdrRow + 1; r < best.length; r++) {
    const oz = String(best[r]?.[originCol] ?? '').trim().toUpperCase();
    if (!ZONE.test(oz)) continue;
    origins.add(oz);
    for (const h of hdr) {
      const rate = num(best[r]?.[h.col]);
      if (rate > 0) { slabs.push({ originZone: oz, zone: h.zone, rateType: 'PLUSKG', weight: 1, rate }); dests.add(h.zone); }
    }
  }
  if (!slabs.length) notes.push('Zone axes found but no numeric rates in the grid — is the template filled?');
  return { family, slabs, origins: [...origins], dests: [...dests], notes };
}

const band = (txt: any): [number, number] => {
  const n = String(txt).match(/\d+/g) || [];
  return n.length >= 2 ? [Number(n[0]), Number(n[1])] : [0, 0];
};

/** Parse the PINCODE MAPPING file → rows for /pincodes/mapping/bulk. Header-name driven. */
export async function parsePincodeMapping(file: File): Promise<Record<string, any>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames.find((n) => /pincode/i.test(n)) || wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, blankrows: false });
  let h = -1;
  rows.forEach((r, i) => { const low = (r || []).map((x) => String(x ?? '').trim().toLowerCase()); if (low.includes('pincode') && (low.includes('dp zone') || low.includes('edl'))) h = i; });
  if (h < 0) throw new Error('Header row (Pincode / DP ZONE / EDL) not found');
  const header = rows[h].map((x) => String(x ?? '').trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const pinC = col('pincode');
  const areaIdx = header.map((v, i) => (v === 'area' ? i : -1)).filter((i) => i >= 0);
  const scC = col('service centre');
  const cityC = areaIdx[0] ?? pinC + 1;
  const areaNameC = areaIdx[1] ?? scC + 1;
  const surfC = header.findIndex((v) => v.startsWith('surfac')); // "Surfacae Zone" typo-safe
  const g = (r: any[], c: number) => { if (c < 0) return null; const v = r[c]; return v == null ? null : (typeof v === 'number' && v === Math.floor(v) ? String(v) : String(v).trim()); };
  const out: Record<string, any>[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const pin = g(r, pinC);
    if (!pin || !/^\d{6}$/.test(pin)) continue;
    out.push({
      pincode: pin, city: g(r, cityC), serviceCentre: g(r, scC), areaName: g(r, areaNameC), state: g(r, col('state')),
      dpZone: g(r, col('dp zone')), surfaceZone: g(r, surfC), apexZone: g(r, col('apex zone')),
      ecomZone: g(r, col('ecomzone')) ?? g(r, col('ecom zone')), edl: g(r, col('edl')),
      edlDistanceKm: g(r, col('edl distance')), tat: g(r, col('tat')),
    });
  }
  return out;
}

const excelDate = (v: any): string | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 1000) { const ms = Math.round((v - 25569) * 86400000); return new Date(ms).toISOString().slice(0, 10); }
  const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Parse the "Vendor bill" file → rows for /vendor-bills/bulk. Handles the two AWB columns
 *  (tracking AWB vs AWB charge) by header position. */
export async function parseVendorBill(file: File): Promise<Record<string, any>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
  let h = -1;
  rows.forEach((r, i) => { const low = (r || []).map((x) => String(x ?? '').trim().toLowerCase()); if (low.some((v) => v.includes('vendor')) && low.includes('awb') && low.some((v) => v.includes('freight'))) h = i; });
  if (h < 0) throw new Error('Header row (Vendor Code / AWB / Freight) not found');
  const header = rows[h].map((x) => String(x ?? '').trim().toLowerCase());
  const idx = (pred: (v: string) => boolean, nth = 0) => { let c = 0; for (let i = 0; i < header.length; i++) if (pred(header[i])) { if (c === nth) return i; c++; } return -1; };
  const col = (name: string) => header.indexOf(name);
  const awbIdxs = header.map((v, i) => (v === 'awb' ? i : -1)).filter((i) => i >= 0);
  const c = {
    vendorCode: idx((v) => v.includes('vendor')), product: col('product'), productType: idx((v) => v.includes('product type')),
    awb: awbIdxs[0] ?? col('awb'), forwardingNo: idx((v) => v.includes('forwarding')), pickupDate: idx((v) => v.includes('pick')),
    origin: col('origin'), destination: col('destination'), actWeight: idx((v) => v.includes('act') && v.includes('weight')),
    chrgWeight: idx((v) => v.includes('chrg') || (v.includes('charg') && v.includes('weight'))), pcs: col('pcs'),
    freight: col('freight'), fs: idx((v) => v.trim() === 'fs'), caf: col('caf'), awbCharge: awbIdxs[1] ?? -1,
    greenTax: idx((v) => v.includes('green')), edl: col('edl'), fov: col('fov'), tdd: col('tdd'), topay: col('topay'),
    total: idx((v) => v.trim() === 'total'), totalWithGst: idx((v) => v.includes('total') && v.includes('gst')),
    destPincode: idx((v) => v.includes('pincode')), declaredValue: idx((v) => v.includes('declared')),
  };
  const g = (r: any[], i: number) => (i < 0 ? null : r[i]);
  const out: Record<string, any>[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const awb = g(r, c.awb); const vc = g(r, c.vendorCode);
    if (!awb || !vc) continue;
    out.push({
      vendorCode: String(vc).trim(), product: g(r, c.product), productType: g(r, c.productType),
      awb: String(typeof awb === 'number' && awb === Math.floor(awb) ? awb : awb).trim(),
      forwardingNo: g(r, c.forwardingNo), pickupDate: excelDate(g(r, c.pickupDate)),
      origin: g(r, c.origin), destination: g(r, c.destination), actWeight: g(r, c.actWeight), chrgWeight: g(r, c.chrgWeight), pcs: g(r, c.pcs),
      freight: g(r, c.freight), fs: g(r, c.fs), caf: g(r, c.caf), awbCharge: g(r, c.awbCharge), greenTax: g(r, c.greenTax),
      edl: g(r, c.edl), fov: g(r, c.fov), tdd: g(r, c.tdd), topay: g(r, c.topay), total: g(r, c.total), totalWithGst: g(r, c.totalWithGst),
      destPincode: g(r, c.destPincode) != null ? String(Math.trunc(Number(g(r, c.destPincode)) || 0) || g(r, c.destPincode)) : null,
      declaredValue: g(r, c.declaredValue),
    });
  }
  return out;
}

/** Parse the EDL Matrix file → cells for /rate-cards/edl/bulk. */
export async function parseEdlMatrix(file: File): Promise<{ kmFrom: number; kmTo: number; wtFromKg: number; wtToKg: number; rate: number }[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
  // header row = the one with >=2 weight-band cells (contain "kg")
  let hRow = -1; const wtCols: { col: number; from: number; to: number }[] = [];
  rows.forEach((r, i) => {
    const cells = (r || []).map((v, c) => ({ v: String(v ?? ''), c })).filter((x) => /\d+\s*-\s*\d+\s*kg/i.test(x.v));
    if (cells.length > wtCols.length) { hRow = i; wtCols.length = 0; cells.forEach((x) => { const [f, t] = band(x.v); wtCols.push({ col: x.c, from: f, to: t }); }); }
  });
  if (hRow < 0) throw new Error('Weight-band header (e.g. "0-100 kgs") not found');
  const out: { kmFrom: number; kmTo: number; wtFromKg: number; wtToKg: number; rate: number }[] = [];
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kmCell = (r || []).find((v) => /\d+\s*-\s*\d+\s*km/i.test(String(v ?? '')));
    if (!kmCell) continue;
    const [kf, kt] = band(kmCell);
    for (const w of wtCols) {
      const rate = Number(r[w.col]);
      if (rate > 0) out.push({ kmFrom: kf, kmTo: kt, wtFromKg: w.from, wtToKg: w.to, rate });
    }
  }
  return out;
}

const findHeader = (rows: any[][], must: string[]): { h: number; header: string[] } => {
  for (let i = 0; i < rows.length; i++) {
    const low = (rows[i] || []).map((x) => String(x ?? '').trim().toLowerCase());
    if (must.every((m) => low.some((v) => v.includes(m)))) return { h: i, header: low };
  }
  throw new Error(`Header row (${must.join(', ')}) not found`);
};
const groupFromProduct = (name?: string, code?: string): string => {
  const n = String(name ?? '').toUpperCase(), c = String(code ?? '').toUpperCase();
  if (n.includes('AIR') || ['APEX', 'TAPEX', 'IPORT'].includes(c)) return 'Air';
  if (n.includes('TRAIN')) return 'Train';
  return 'Surface';
};

/** Parse the Product template (Product Code / Name / Type / Service) → master rows. */
export async function parseProductSheet(file: File): Promise<{ code: string; name: string; attrs: any }[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
  const { h, header } = findHeader(rows, ['product code', 'product name']);
  const col = (kw: string) => header.findIndex((v) => v.includes(kw));
  const ci = { code: col('product code'), name: col('product name'), type: col('product type'), svc: col('service') };
  const out: { code: string; name: string; attrs: any }[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const code = String(r[ci.code] ?? '').trim();
    if (!code) continue;
    const name = String(r[ci.name] ?? '').trim();
    out.push({ code, name, attrs: { productType: r[ci.type] ? String(r[ci.type]).trim() : null, service: ci.svc >= 0 && r[ci.svc] ? String(r[ci.svc]).trim() : null, groupType: groupFromProduct(name, code) } });
  }
  return out;
}

/** Parse the Vendor template → vendor rows for /vendors. */
export async function parseVendorSheet(file: File): Promise<any[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
  const { h, header } = findHeader(rows, ['vendor code', 'vendor name']);
  const col = (kw: string) => header.findIndex((v) => v.includes(kw));
  const s = (r: any[], c: number) => (c >= 0 && r[c] != null && r[c] !== '' ? String(r[c]).trim() : undefined);
  const ci = {
    code: col('vendor code'), name: col('vendor name'), addr: col('address'), tel1: header.findIndex((v) => v.includes('phone 1')),
    tel2: header.findIndex((v) => v.includes('phone 2')), person: col('contact person'), addr2: header.findIndex((v) => v.includes('address 2')),
    email: col('email'), fax: col('fax'), mobile: col('mobile'), origin: col('origin'), currency: col('currency'), gst: col('gst'),
  };
  const out: any[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const code = s(r, ci.code);
    if (!code) continue;
    out.push({
      vendorCode: code, name: s(r, ci.name) || code, modes: 'AIR,SURFACE', addressLine: s(r, ci.addr), tel1: s(r, ci.tel1), tel2: s(r, ci.tel2),
      contactPerson: s(r, ci.person), addressLine2: s(r, ci.addr2), contactEmail: s(r, ci.email), fax: s(r, ci.fax), contactPhone: s(r, ci.mobile),
      origin: s(r, ci.origin), currency: s(r, ci.currency) || 'INR', gstin: s(r, ci.gst), isActive: true,
    });
  }
  return out;
}

/** Download a blank courier (DP/TDD/NDD) template: origin blocks × weight slabs × dest zones. */
export function downloadCourierTemplate() {
  const dests = ['A', 'B', 'C', 'OTHER'];
  const origins = ['A', 'B', 'C', 'OTHER'];
  const slabs = ['FIRST 250 GM', 'FIRST 500 GM', 'EVERY ADD 500 GM'];
  const aoa: any[][] = [
    ['Weight Slab', 'Zone', 'Intracity', 'Within Region', 'Metro', 'ROI'],
    ['', '', 'A', 'B', 'C', 'OTHER'],
  ];
  origins.forEach((oz) => {
    slabs.forEach((sl, i) => aoa.push([sl, i === 0 ? oz : '', '', '', '', '']));
    aoa.push([]); // blank separator between origin blocks
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DP, TDD AND NDD');
  XLSX.writeFile(wb, 'Logimart-courier-rate-template.xlsx');
}

/** Download a blank cargo rate template carrying BOTH Apex and Surface in one file.
 *  Columns: Customer Code · Vendor · Product · Origin\Dest · <18 dest zones>. One 18-row block per
 *  (vendor × product); upload creates one rate card each. APEX → Air card, SURFACE → Surface card.
 *  Fill the ₹/kg cells; the Customer Code / Vendor / Product on the block's first row identify it. */
export function downloadCargoTemplate(vendorNames: string[] = [], productCodes: string[] = ['APEX', 'SURFACE']) {
  const zones = ['N1', 'N2', 'N3', 'N4', 'C1', 'C2', 'W1', 'W2', 'W3', 'S1', 'S2', 'S3', 'E1', 'E2', 'E3', 'NE1', 'NE2', 'NE3'];
  const header = ['Customer Code', 'Vendor', 'Product', 'Origin \\ Dest', ...zones];
  const blank = zones.map(() => '');
  const vendors = ['SELF', ...Array.from(new Set(vendorNames.map((v) => String(v).trim()).filter(Boolean)))];
  const products = Array.from(new Set((productCodes.length ? productCodes : ['APEX', 'SURFACE']).map((p) => String(p).trim().toUpperCase()).filter(Boolean)));
  const aoa: any[][] = [header];
  for (const vend of vendors) {
    for (const prod of products) {
      // First row of each block carries Customer Code + Vendor + Product; the rest are origin rows.
      zones.forEach((oz, i) => aoa.push([i === 0 ? 'CUST001' : '', i === 0 ? vend : '', i === 0 ? prod : '', oz, ...blank]));
      aoa.push([]); // spacer between blocks
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Apex And Surface');
  XLSX.writeFile(wb, 'Logimart-cargo-rate-template.xlsx');
}

/** Export a customer's rate cards to XLS for review: a Summary sheet + one sheet per card
 *  (header + accessorials + the zone×weight slab matrix). */
export function exportRateCardsXlsx(clientName: string, cards: any[]): void {
  const wb = XLSX.utils.book_new();

  const sumHead = ['Network', 'Product', 'Mode', 'FSC mode', 'Fuel %', 'Fuel mech', 'FOV %', 'FOV min', 'ODA flat', 'ODA /kg', 'ODA min', 'Min freight', 'Min chg kg', 'Vol÷', 'CFT', 'Valid from', 'Valid to', 'Active'];
  const sumRows = cards.map((c) => [
    c.network, c.product, c.mode ?? '', c.fuelMode ?? '', num(c.fuelPct), c.fuelMechanism ?? '',
    num(c.fovPct), num(c.fovMin), num(c.odaFlat), num(c.odaPerKg), num(c.odaMin), num(c.minFreight),
    num(c.minChargeableKg), num(c.volumetricDivisor), num(c.cft),
    c.validFrom ? String(c.validFrom).slice(0, 10) : '', c.validTo ? String(c.validTo).slice(0, 10) : '', c.isActive === false ? 'No' : 'Yes',
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Rate cards — ${clientName}`], [], sumHead, ...sumRows]), 'Summary');

  const used = new Set<string>();
  for (const c of cards) {
    const base = `${c.network}-${c.product}`.replace(/[\/?*[\]:]/g, '').slice(0, 28) || 'card';
    let name = base, i = 1;
    while (used.has(name)) name = `${base}_${i++}`;
    used.add(name);

    const CJ: Record<string, any> = c.charges || {};
    const accRows = Object.entries(CJ)
      .map(([code, cfg]: any) => [code, cfg?.value ?? '', cfg?.min ?? '', cfg?.perKg ?? ''])
      .filter((r) => r[1] !== '' || r[2] !== '' || r[3] !== '');

    const zoneSet = new Set<string>();
    (c.slabs || []).forEach((s: any) => zoneSet.add(s.zone));
    const zonesArr = [...zoneSet];
    const rowMap = new Map<string, any>();
    (c.slabs || []).forEach((s: any) => {
      const k = `${s.rateType}|${s.weight}`;
      if (!rowMap.has(k)) rowMap.set(k, { rateType: s.rateType, weight: s.weight, rates: {} as Record<string, any> });
      rowMap.get(k).rates[s.zone] = s.rate;
    });
    const matrixRows = [...rowMap.values()].map((r) => [r.rateType, r.weight, ...zonesArr.map((z) => r.rates[z] ?? '')]);

    const aoa: any[][] = [
      [`${c.network} · ${c.product} · ${c.mode || ''}`],
      [],
      ['FSC', c.fuelMode === 'DYNAMIC' ? `Diesel (${c.fuelMechanism || ''})` : `${num(c.fuelPct)}%`, '', 'Min freight', num(c.minFreight)],
      ['Vol÷', num(c.volumetricDivisor), '', 'CFT', num(c.cft)],
      [],
      ['Accessorials'], ['Charge', 'Value', 'Min', '₹/kg'], ...accRows,
      [],
      ['Zone × weight slab rates (₹)'], ['Slab type', 'Weight/unit', ...zonesArr], ...matrixRows,
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }

  XLSX.writeFile(wb, `ratecards-${clientName.replace(/[^a-z0-9]+/gi, '_')}.xlsx`);
}

/** Parse a customer-code-wise cargo rate workbook. Layout: columns CUSTOMER · VENDOR · PRODUCT ·
 *  Origin\Dest · <18 dest-zone columns>. Each block = one (customer, vendor, product); the block's
 *  rows are origin zones with a ₹/kg rate per dest zone. Returns one entry per block. */
export async function parseBulkCargoRates(file: File): Promise<{ customerCode: string; vendor: string; product: string; slabs: ParsedSlab[] }[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const out: { customerCode: string; vendor: string; product: string; slabs: ParsedSlab[] }[] = [];
  const findCol = (hdr: string[], ...keys: string[]) => hdr.findIndex((h) => keys.some((k) => h.includes(k)));

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: true, blankrows: false });
    // header row = the one with the most dest-zone codes
    let hdrRow = -1, best = 0;
    rows.forEach((r, i) => { const n = (r || []).filter((v) => CARGO_ZONE.test(String(v ?? '').trim())).length; if (n > best) { best = n; hdrRow = i; } });
    if (hdrRow < 0) continue;
    const hdr = (rows[hdrRow] || []).map((v) => String(v ?? '').trim().toUpperCase());
    const custCol = findCol(hdr, 'CUSTOM');
    const vendCol = findCol(hdr, 'VENDOR');
    const prodCol = findCol(hdr, 'PRODUCT');
    const originCol = findCol(hdr, 'ORIGIN', 'DEST');
    const destCols: { idx: number; zone: string }[] = [];
    hdr.forEach((v, idx) => { if (CARGO_ZONE.test(v)) destCols.push({ idx, zone: v }); });
    if (prodCol < 0 || originCol < 0 || !destCols.length) continue;

    let cur: { customerCode: string; vendor: string; product: string; slabs: ParsedSlab[] } | null = null;
    for (let i = hdrRow + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const prod = String(r[prodCol] ?? '').trim();
      if (prod) { // new block
        if (cur && cur.slabs.length) out.push(cur);
        cur = {
          customerCode: String(r[custCol] ?? '').trim(),
          vendor: String(r[vendCol] ?? '').trim().toUpperCase(),
          product: prod.toUpperCase(),
          slabs: [],
        };
      }
      if (!cur) continue;
      const origin = String(r[originCol] ?? '').replace(/\s+/g, '').toUpperCase();
      if (!CARGO_ZONE.test(origin)) continue;
      for (const d of destCols) { const rate = num(r[d.idx]); if (rate > 0) cur.slabs.push({ originZone: origin, zone: d.zone, rateType: 'PLUSKG', weight: 1, rate }); }
    }
    if (cur && cur.slabs.length) out.push(cur);
  }
  return out;
}

/** Parse a multi-VENDOR cargo rate workbook: one 18×18 zone matrix per vendor, blocks delimited
 *  by repeated headers. Layout per block: Customer Code · Vendor · Origin\Dest · <18 dest zones>.
 *  Returns one entry per vendor block (product is chosen in the UI, not the sheet). */
export async function parseCargoByVendor(file: File): Promise<{ vendor: string; slabs: ParsedSlab[] }[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const out: { vendor: string; slabs: ParsedSlab[] }[] = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: true, blankrows: false });
    // Header rows carry many dest-zone codes; each starts a new vendor block.
    const headerIdx: number[] = [];
    rows.forEach((r, i) => { const n = (r || []).filter((v) => CARGO_ZONE.test(String(v ?? '').trim())).length; if (n >= 8) headerIdx.push(i); });
    if (!headerIdx.length) continue;
    for (let b = 0; b < headerIdx.length; b++) {
      const h = headerIdx[b];
      const end = b + 1 < headerIdx.length ? headerIdx[b + 1] : rows.length;
      const hdr = (rows[h] || []).map((v) => String(v ?? '').trim().toUpperCase());
      const vendCol = hdr.findIndex((x) => x.includes('VENDOR'));
      const originCol = hdr.findIndex((x) => x.includes('ORIGIN') || x.includes('DEST'));
      const destCols: { idx: number; zone: string }[] = [];
      hdr.forEach((v, idx) => { if (CARGO_ZONE.test(v)) destCols.push({ idx, zone: v }); });
      if (originCol < 0 || !destCols.length) continue;
      let vendor = '';
      const slabs: ParsedSlab[] = [];
      for (let i = h + 1; i < end; i++) {
        const r = rows[i] || [];
        if (vendCol >= 0 && String(r[vendCol] ?? '').trim()) vendor = String(r[vendCol]).trim();
        const origin = String(r[originCol] ?? '').replace(/\s+/g, '').toUpperCase();
        if (!CARGO_ZONE.test(origin)) continue;
        for (const d of destCols) { const rate = num(r[d.idx]); if (rate > 0) slabs.push({ originZone: origin, zone: d.zone, rateType: 'PLUSKG', weight: 1, rate }); }
      }
      out.push({ vendor: vendor || 'SELF', slabs });
    }
  }
  return out;
}
