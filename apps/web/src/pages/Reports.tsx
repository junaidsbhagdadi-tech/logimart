import { useEffect, useState } from 'react';
import { api } from '../api';

const REPORTS: { group: string; items: { key: string; label: string; noDate?: boolean }[] }[] = [
  { group: 'Operations', items: [
    { key: 'MIS', label: 'MIS Report' },
    { key: 'SCAN', label: 'Scan Report' },
    { key: 'DELIVERY_STATUS', label: 'Delivery Status' },
  ] },
  { group: 'Statements', items: [
    { key: 'DAILY', label: 'Daily Report' },
    { key: 'CUSTOMER_SUMMARY', label: 'Customer Summary' },
    { key: 'PRODUCT_SUMMARY', label: 'Product Summary' },
    { key: 'DESTINATION_SUMMARY', label: 'Destination Summary' },
  ] },
  { group: 'AR', items: [
    { key: 'RECEIVABLES', label: 'Receivables (Outstanding)', noDate: true },
  ] },
];
const ALL = REPORTS.flatMap((g) => g.items);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function Reports() {
  const [type, setType] = useState('MIS');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState<{ columns: { key: string; label: string }[]; rows: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const def = ALL.find((r) => r.key === type)!;

  const run = async () => {
    setBusy(true); setError('');
    try { setData(await api.runReport(type, def.noDate ? undefined : from, def.noDate ? undefined : to)); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { run(); /* eslint-disable-next-line */ }, [type]);

  const exportCsv = () => {
    if (!data) return;
    const head = data.columns.map((c) => c.label).join(',');
    const body = data.rows.map((r) => data.columns.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([head + '\n' + body], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `logimart-${type.toLowerCase()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <h1>📊 Reports</h1>

      <div className="card" style={{ padding: 14 }}>
        {REPORTS.map((g) => (
          <div key={g.group} style={{ marginBottom: 8 }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{g.group}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {g.items.map((r) => (
                <button key={r.key} className={r.key === type ? '' : 'secondary'} style={{ padding: '8px 14px' }} onClick={() => setType(r.key)}>{r.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            {!def.noDate && (
              <>
                <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              </>
            )}
            <button onClick={run} disabled={busy}>{busy ? 'Running…' : '▶ Run'}</button>
          </div>
          {data && data.rows.length > 0 && <button className="secondary" onClick={exportCsv}>⬇ Export CSV</button>}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {data && (
        <div className="card">
          <h2>{def.label} — {data.rows.length} row(s)</h2>
          <table>
            <thead><tr>{data.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>{data.columns.map((c) => <td key={c.key}>{String(r[c.key] ?? '—')}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <p className="muted">No data for this range.</p>}
        </div>
      )}
    </>
  );
}
