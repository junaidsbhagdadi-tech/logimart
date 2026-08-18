import { useState } from 'react';
import { api } from '../api';

/** Delivery Run Sheet — assign a batch of AWBs to a field executive and mark them OFD. */
export function Drs() {
  const [riderId, setRiderId] = useState('');
  const [awbInput, setAwbInput] = useState('');
  const [awbs, setAwbs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ awb: string; ok: boolean; error?: string }[]>([]);

  const add = () => {
    const a = awbInput.trim().toUpperCase();
    if (a && !awbs.includes(a)) setAwbs((x) => [...x, a]);
    setAwbInput('');
  };

  const run = async () => {
    setError(''); setMsg(''); setResults([]);
    if (!riderId) { setError('Enter the field executive (driver) user id.'); return; }
    if (awbs.length === 0) { setError('Add at least one AWB.'); return; }
    setBusy(true);
    const res: { awb: string; ok: boolean; error?: string }[] = [];
    for (const a of awbs) {
      try { await api.assignDelivery(a, +riderId); await api.markOfd(a); res.push({ awb: a, ok: true }); }
      catch (e: any) { res.push({ awb: a, ok: false, error: e.message }); }
    }
    setResults(res); setBusy(false);
    setMsg(`Run sheet dispatched — ${res.filter((r) => r.ok).length}/${awbs.length} out for delivery.`);
  };

  return (
    <>
      <h1>🚚 Delivery Run Sheet (DRS)</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}
      <div className="card">
        <h2>Build run sheet</h2>
        <div className="grid cols-3">
          <div><label>Field executive (driver user id)</label><input value={riderId} onChange={(e) => setRiderId(e.target.value)} placeholder="e.g. 4" /></div>
          <div style={{ gridColumn: 'span 2' }}>
            <label>Add AWB</label>
            <div className="row"><input value={awbInput} onChange={(e) => setAwbInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="scan/type AWB, press Enter" /><button className="secondary" onClick={add}>+ Add</button></div>
          </div>
        </div>
        {awbs.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>#</th><th>AWB</th><th></th></tr></thead>
            <tbody>{awbs.map((a, i) => <tr key={a}><td>{i + 1}</td><td><strong>{a}</strong></td><td style={{ textAlign: 'right' }}><button className="secondary" style={{ padding: '4px 10px' }} onClick={() => setAwbs((x) => x.filter((y) => y !== a))}>✕</button></td></tr>)}</tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted">Total AWB count: <strong>{awbs.length}</strong></div>
          <button onClick={run} disabled={busy || awbs.length === 0}>{busy ? 'Dispatching…' : '🚚 Assign & OFD'}</button>
        </div>
      </div>
      {results.length > 0 && (
        <div className="card">
          <h2>Result</h2>
          <table><thead><tr><th>AWB</th><th>Status</th></tr></thead><tbody>
            {results.map((r) => <tr key={r.awb}><td><strong>{r.awb}</strong></td><td>{r.ok ? <span className="badge DELIVERED">OFD</span> : <span className="badge EXCEPTION">{r.error}</span>}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </>
  );
}
