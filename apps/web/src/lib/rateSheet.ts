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
const CARGO_ZONE = /^(N[1-4]|C[1-2]|W[1-3]|S[1-3]|NE[1-3])$/i;
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

/** Download a blank cargo (Apex/Surface) rate template: origin rows × dest cols. */
export function downloadCargoTemplate() {
  const zones = ['N1', 'N2', 'N3', 'N4', 'C1', 'C2', 'W1', 'W2', 'W3', 'S1', 'S2', 'S3', 'E1', 'E2', 'E3', 'NE1', 'NE2', 'NE3'];
  const aoa: any[][] = [['Origin \\ Dest', ...zones]];
  zones.forEach((oz) => aoa.push([oz, ...zones.map(() => '')]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Apex And surface');
  XLSX.writeFile(wb, 'Logimart-cargo-rate-template.xlsx');
}
