import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

/** Bulk booking — paste or upload a CSV (export from Excel) → many AWBs at once.
 * MPS: one row per BOX; rows sharing the same `ref` are grouped into a single AWB
 * (each row contributes one piece with its own dimensions). Shipment-level fields are
 * taken from the first row of each ref group. A blank ref = a single-box shipment. */
const COLS_STAFF = ['ref', 'clientId', 'serviceMode', 'originPincode', 'destPincode', 'consigneeName', 'consigneePhone', 'consigneeAddress', 'declaredValue', 'deadKg', 'lengthCm', 'widthCm', 'heightCm'];
const COLS_CLIENT = COLS_STAFF.filter((c) => c !== 'clientId');

export function BulkBooking() {
  const { user } = useAuth();
  const ownClientId = user?.clientId ? Number(user.clientId) : null;
  const cols = ownClientId ? COLS_CLIENT : COLS_STAFF;

  const [hubIds, setHubIds] = useState<[number, number]>([1, 2]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ total: number; created: number; results: { row: number; ok: boolean; awb?: string; error?: string }[] } | null>(null);

  useEffect(() => {
    api.listHubs().then((hs) => { if (hs[0]) setHubIds([Number(hs[0].id), Number((hs[1] ?? hs[0]).id)]); }).catch(() => {});
  }, []);

  const rows = useMemo(() => parseCsv(text), [text]);
  // group box-rows into shipments by `ref` (blank ref = its own single-box shipment)
  const grouped = useMemo(() => {
    const m = new Map<string, Record<string, string>[]>();
    rows.forEach((r, i) => {
      const key = r.ref && r.ref.trim() ? r.ref.trim() : `__row${i}`;
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    });
    return Array.from(m.values());
  }, [rows]);

  const downloadTemplate = () => {
    // A1 = a 2-box MPS shipment (two rows, same ref); A2 = a single-box shipment.
    const sample = ownClientId
      ? [
          'A1,ROAD_PTL,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,5,30,20,15',
          'A1,ROAD_PTL,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,8,40,30,20',
          'A2,ROAD_PTL,560001,400001,Beta Corp,9812345670,5 Fort Mumbai,12000,3,25,20,10',
        ].join('\n')
      : [
          'A1,1,ROAD_PTL,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,5,30,20,15',
          'A1,1,ROAD_PTL,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,8,40,30,20',
          'A2,1,ROAD_PTL,560001,400001,Beta Corp,9812345670,5 Fort Mumbai,12000,3,25,20,10',
        ].join('\n');
    const csv = cols.join(',') + '\n' + sample + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logimart-bulk-booking-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = (f: File | null) => { if (f) f.text().then(setText); };

  const submit = async () => {
    setError(''); setResult(null);
    if (grouped.length === 0) { setError('No rows found. Paste CSV or upload a file.'); return; }
    const dtos = grouped.map((grp) => {
      const first = grp[0];
      return {
        clientId: ownClientId ?? Number(first.clientId),
        serviceMode: (first.serviceMode || 'ROAD_PTL').toUpperCase(),
        originHubId: hubIds[0], destHubId: hubIds[1],
        originZone: 'SOUTH', destZone: 'SOUTH',
        originPincode: first.originPincode || undefined,
        destPincode: first.destPincode || undefined,
        consigneeName: first.consigneeName || undefined,
        consigneePhone: first.consigneePhone || undefined,
        consigneeAddress: first.consigneeAddress || undefined,
        declaredValue: first.declaredValue ? Number(first.declaredValue) : undefined,
        // one piece per box-row, each with its own dimensions (MPS)
        pieces: grp.map((r) => ({
          deadKg: Number(r.deadKg) || 0.5,
          lengthCm: r.lengthCm ? Number(r.lengthCm) : undefined,
          widthCm: r.widthCm ? Number(r.widthCm) : undefined,
          heightCm: r.heightCm ? Number(r.heightCm) : undefined,
        })),
      };
    });
    setBusy(true);
    try { setResult(await api.bulkCreateShipments(dtos)); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>📥 Bulk Booking</h1>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2>How it works</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Fill <strong>one box per row</strong> in Excel, save as CSV, then upload or paste below. For a multi-box
          shipment (MPS), give every box the <strong>same <code>ref</code></strong> — they book under one AWB, each
          box carrying its own weight + dimensions (L×W×H cm). A blank <code>ref</code> = a single-box shipment.
          E-way bills auto-generate when invoice value ≥ ₹50,000.
        </p>
        <div className="row">
          <button className="secondary" onClick={downloadTemplate}>⬇ Download CSV template</button>
          <label className="secondary" style={{ padding: '10px 16px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
            📎 Upload CSV
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Columns: <code>{cols.join(', ')}</code></div>
      </div>

      <div className="card">
        <h2>Paste / review CSV</h2>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={cols.join(',') + '\n…'}
          style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11 }} />
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted"><strong>{rows.length}</strong> box(es) → <strong>{grouped.length}</strong> shipment(s)</div>
          <button disabled={busy || grouped.length === 0} onClick={submit}>{busy ? 'Booking…' : `Book ${grouped.length} shipment(s)`}</button>
        </div>
      </div>

      {result && (
        <div className="card">
          <h2>Result — {result.created}/{result.total} created</h2>
          <table>
            <thead><tr><th>Row</th><th>Status</th><th>AWB / error</th></tr></thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.ok ? <span className="badge DELIVERED">OK</span> : <span className="badge EXCEPTION">FAILED</span>}</td>
                  <td>{r.ok ? <Link to={`/shipments/${r.awb}`}><strong>{r.awb}</strong></Link> : <span className="muted">{r.error}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Minimal CSV parser: header row + comma-separated values, honouring "quoted" fields. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
