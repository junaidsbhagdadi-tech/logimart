import { useState } from 'react';
import { api } from '../api';

/**
 * #14 — Bulk change after the vendor bill, in the team's own sheet format. Any blank cell = unchanged.
 * Columns (header names are matched loosely): AWB NO | Customer Code | Origin Pincode | Destination Pin code |
 * Vendor Code | Product Code | Weight | Invoice value | Booking Date | EDL | COD | Appointment Charges | Topay charges
 */
const TEMPLATE = ['AWB NO', 'Customer Code', 'Origin Pincode', 'Destination Pin code', 'Vendor Code', 'Product Code', 'Weight', 'Invoice value', 'Booking Date', 'EDL', 'COD', 'Appointment Charges', 'Topay charges'];

// Normalised header → field the API expects.
const FIELD: Record<string, string> = {
  awbno: 'awb', awb: 'awb', awbnumber: 'awb',
  customercode: 'customerCode', accountcode: 'customerCode',
  originpincode: 'originPincode', originpin: 'originPincode',
  destinationpincode: 'destPincode', destinationpin: 'destPincode', destpincode: 'destPincode',
  vendorcode: 'vendorCode', vendor: 'vendorCode',
  productcode: 'productCode', product: 'productCode',
  weight: 'weight', chargeweight: 'weight',
  invoicevalue: 'invoiceValue', shipmentvalue: 'invoiceValue',
  bookingdate: 'bookingDate', manifestdate: 'bookingDate',
  edl: 'edl', edlcharges: 'edl',
  cod: 'cod', codcharges: 'cod',
  appointmentcharges: 'appointment', appointment: 'appointment',
  topaycharges: 'topay', topay: 'topay',
};
const norm = (h: any) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const p2 = (n: number) => String(n).padStart(2, '0');

/** Excel serial / Date / text → DD-MM-YYYY (the format the server's date change expects). */
function toDmy(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v.getTime())) return `${p2(v.getDate())}-${p2(v.getMonth() + 1)}-${v.getFullYear()}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`; }
  return String(v).trim();
}

type Result = { row: number; awb: string; ok: boolean; changed?: string[]; error?: string };

export function BulkChangeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [fileName, setFileName] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const [err, setErr] = useState('');

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE, ['L1000000101', '', '', '', '', '', '12.5', '', '', '', '', '', '']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Bulk change');
    XLSX.writeFile(wb, 'bulk-change-template.xlsx');
  };

  const onFile = async (f?: File | null) => {
    if (!f) return;
    setErr(''); setResults(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }) as any[][];
      const hi = aoa.findIndex((r) => r.some((c) => FIELD[norm(c)] === 'awb'));
      if (hi < 0) { setErr('No "AWB NO" column found — use the template headers.'); return; }
      const head = aoa[hi].map((h) => FIELD[norm(h)] ?? null);
      setUnknown(aoa[hi].filter((h, i) => String(h).trim() && !head[i]).map(String));
      const out = aoa.slice(hi + 1).map((r) => {
        const o: Record<string, any> = {};
        head.forEach((k, i) => { if (!k) return; const v = r[i]; o[k] = k === 'bookingDate' ? toDmy(v) : (v instanceof Date ? toDmy(v) : String(v ?? '').trim()); });
        return o;
      }).filter((o) => String(o.awb ?? '').trim());
      setRows(out); setFileName(f.name);
    } catch (e: any) { setErr('Could not read the file: ' + e.message); }
  };

  const apply = async () => {
    if (!rows.length) return;
    if (!confirm(`Apply changes to ${rows.length.toLocaleString()} AWB(s)? Blank cells are left unchanged. Invoiced AWBs are refused (cancel/rebill first).`)) return;
    setBusy(true); setErr(''); setProg(0);
    const all: Result[] = [];
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const r = await api.bulkChangeAwbs(rows.slice(i, i + 200));
        all.push(...r.results.map((x) => ({ ...x, row: x.row + i })));
        setProg(Math.min(i + 200, rows.length));
      }
      setResults(all); onDone();
    } catch (e: any) { setErr(`Stopped at row ${all.length + 1}: ${e.message}. Rows before it were applied.`); setResults(all); }
    finally { setBusy(false); }
  };

  const exportResults = async () => {
    if (!results) return;
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['Row', 'AWB', 'Result', 'Changed / Error'], ...results.map((r) => [r.row, r.awb, r.ok ? 'OK' : 'FAILED', r.ok ? (r.changed || []).join(', ') : r.error ?? ''])]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, `bulk-change-results-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const failed = results?.filter((r) => !r.ok) ?? [];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && onClose()}>
      <div className="card" style={{ width: 760, maxWidth: '94%', maxHeight: '88vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>✏️ Bulk change AWBs</h2>
          <button className="secondary" style={{ padding: '4px 12px' }} onClick={onClose} disabled={busy}>✕</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Upload your vendor-bill correction sheet. <strong>Any blank cell is left unchanged.</strong> Customer Code moves the AWB to that account;
          pincode / vendor / product changes re-derive the zone; Weight sets the chargeable weight; Booking Date (DD-MM-YYYY) moves the billing month;
          EDL / COD / Appointment / To-pay set those charges on the AWB (COD → the Cheque/DD-on-delivery charge). Invoiced AWBs are refused.
        </p>
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="secondary" onClick={downloadTemplate}>⬇ Template</button>
          <label className="secondary" style={{ padding: '8px 12px', borderRadius: 10, cursor: 'pointer', border: '1px solid var(--border)', fontSize: 13 }}>
            📎 Upload Excel / CSV<input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {fileName && <span className="muted" style={{ fontSize: 12.5 }}>{fileName} — <strong>{rows.length.toLocaleString()}</strong> AWB row(s)</span>}
          <button style={{ marginLeft: 'auto' }} disabled={busy || !rows.length} onClick={apply}>{busy ? `Applying ${prog.toLocaleString()} / ${rows.length.toLocaleString()}…` : `Apply to ${rows.length.toLocaleString()}`}</button>
        </div>
        {unknown.length > 0 && <p className="muted" style={{ fontSize: 12 }}>Ignored column(s): {unknown.join(', ')}</p>}
        {results && (
          <>
            <div className="row" style={{ gap: 8, margin: '12px 0 6px', alignItems: 'center' }}>
              <span className="badge DELIVERED">{results.filter((r) => r.ok).length.toLocaleString()} changed</span>
              {failed.length > 0 && <span className="badge EXCEPTION">{failed.length.toLocaleString()} failed</span>}
              <button className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={exportResults}>⬇ Results</button>
            </div>
            {failed.length > 0 && (
              <table style={{ fontSize: 12.5 }}>
                <thead><tr><th>Row</th><th>AWB</th><th>Why it failed</th></tr></thead>
                <tbody>{failed.slice(0, 200).map((f) => <tr key={f.row}><td>{f.row}</td><td className="mono">{f.awb || '—'}</td><td className="muted">{f.error}</td></tr>)}</tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
