import { useMemo, useState } from 'react';
import { api } from '../api';

// Master types importable from CSV. code + name are the key/label; any other
// columns become attrs (so Destination/Charge/etc. import with their extra fields).
const TYPES: { key: string; label: string; cols: string }[] = [
  { key: 'DESTINATION', label: 'Destinations', cols: 'code,name,state,zone,serviceType,country' },
  { key: 'PRODUCT', label: 'Products', cols: 'code,name,productType,groupType,docType,service' },
  { key: 'CHARGE', label: 'Charges', cols: 'code,name,baseOn,rate,hsn' },
  { key: 'ZONE', label: 'Zones', cols: 'code,name' },
  { key: 'STATE', label: 'States', cols: 'code,name,zone,gstCode' },
  { key: 'COUNTRY', label: 'Countries', cols: 'code,name,weightUnit,currency' },
  { key: 'SALES_EXEC', label: 'Sales Executives', cols: 'code,name,commissionPct' },
  { key: 'BANK', label: 'Banks', cols: 'code,name,ifsc,branch' },
];

export function Import() {
  const [type, setType] = useState(TYPES[0].key);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ code: string; ok: boolean; error?: string }[]>([]);

  const def = TYPES.find((t) => t.key === type)!;
  const rows = useMemo(() => parseCsv(text), [text]);

  const template = () => {
    const csv = def.cols + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `logimart-${type.toLowerCase()}-template.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const onFile = (f: File | null) => { if (f) f.text().then(setText); };

  const run = async () => {
    setError(''); setResults([]);
    if (rows.length === 0) { setError('No rows. Paste CSV (code,name,…) or upload a file.'); return; }
    setBusy(true);
    const res: { code: string; ok: boolean; error?: string }[] = [];
    for (const r of rows) {
      const { code, name, ...attrs } = r;
      if (!code) continue;
      try { await api.saveMaster(type, { code, name: name || code, attrs }); res.push({ code, ok: true }); }
      catch (e: any) { res.push({ code, ok: false, error: e.message }); }
    }
    setResults(res); setBusy(false);
  };

  return (
    <>
      <h1>📤 Excel / CSV Import</h1>
      {error && <div className="error">{error}</div>}

      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {TYPES.map((t) => (
            <button key={t.key} className={t.key === type ? '' : 'secondary'} style={{ padding: '8px 14px' }} onClick={() => setType(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Import {def.label}</h2>
        <p className="muted" style={{ marginTop: -6 }}>Columns: <code>{def.cols}</code>. First row is the header. Existing codes are updated.</p>
        <div className="row">
          <button className="secondary" onClick={template}>⬇ Template</button>
          <label className="secondary" style={{ padding: '10px 16px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
            📎 Upload CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={def.cols + '\n…'} style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11, marginTop: 12 }} />
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted"><strong>{rows.length}</strong> row(s)</div>
          <button onClick={run} disabled={busy || rows.length === 0}>{busy ? 'Importing…' : `Import ${rows.length} into ${def.label}`}</button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="card">
          <h2>Result — {results.filter((r) => r.ok).length}/{results.length} imported</h2>
          <table><thead><tr><th>Code</th><th>Status</th></tr></thead><tbody>
            {results.map((r, i) => <tr key={i}><td><strong>{r.code}</strong></td><td>{r.ok ? <span className="badge DELIVERED">OK</span> : <span className="badge EXCEPTION">{r.error}</span>}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </>
  );
}

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
