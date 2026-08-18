import { useMemo, useState } from 'react';
import { api } from '../api';

/** Bulk POD import — mark many AWBs delivered from a CSV (awb, piecesDelivered). */
export function BulkPod() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ awb: string; ok: boolean; error?: string }[]>([]);

  const rows = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [awb, pcs] = l.split(',');
    return { awb: (awb || '').trim().toUpperCase(), pcs: Number((pcs || '1').trim()) || 1 };
  }).filter((r) => r.awb && r.awb !== 'AWB'), [text]);

  const template = () => {
    const csv = 'awb,piecesDelivered\nLMT2026000001,1\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logimart-bulk-pod-template.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const onFile = (f: File | null) => { if (f) f.text().then(setText); };

  const run = async () => {
    setError(''); setResults([]);
    if (rows.length === 0) { setError('No rows. Paste CSV (awb,piecesDelivered) or upload a file.'); return; }
    setBusy(true);
    const res: { awb: string; ok: boolean; error?: string }[] = [];
    for (const r of rows) {
      try { await api.recordPod(r.awb, { gpsLat: 0, gpsLng: 0, piecesDelivered: r.pcs }, true); res.push({ awb: r.awb, ok: true }); }
      catch (e: any) { res.push({ awb: r.awb, ok: false, error: e.message }); }
    }
    setResults(res); setBusy(false);
  };

  return (
    <>
      <h1>📥 Bulk POD Import</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <h2>Upload delivered AWBs</h2>
        <p className="muted" style={{ marginTop: -6 }}>CSV columns: <code>awb, piecesDelivered</code>. Marks each AWB delivered (short deliveries allowed).</p>
        <div className="row">
          <button className="secondary" onClick={template}>⬇ Template</button>
          <label className="secondary" style={{ padding: '10px 16px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
            📎 Upload CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'awb,piecesDelivered\n…'} style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11, marginTop: 12 }} />
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted"><strong>{rows.length}</strong> row(s)</div>
          <button onClick={run} disabled={busy || rows.length === 0}>{busy ? 'Importing…' : `Mark ${rows.length} delivered`}</button>
        </div>
      </div>
      {results.length > 0 && (
        <div className="card">
          <h2>Result — {results.filter((r) => r.ok).length}/{results.length} delivered</h2>
          <table><thead><tr><th>AWB</th><th>Status</th></tr></thead><tbody>
            {results.map((r) => <tr key={r.awb}><td><strong>{r.awb}</strong></td><td>{r.ok ? <span className="badge DELIVERED">OK</span> : <span className="badge EXCEPTION">{r.error}</span>}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </>
  );
}
