import { useEffect, useState } from 'react';
import { api } from '../api';

const COLS: { key: string; label: string; num?: boolean; money?: boolean }[] = [
  { key: 'code', label: 'Cust Code' },
  { key: 'customer', label: 'Customer' },
  { key: 'shipments', label: 'Shipments', num: true },
  { key: 'pcs', label: 'PCS', num: true },
  { key: 'actlKg', label: 'Actl Wt', num: true },
  { key: 'chrgKg', label: 'Chrg Wt', num: true },
  { key: 'totalSales', label: 'Total Sales', money: true },
  { key: 'fuel', label: 'Fuel', money: true },
  { key: 'tax', label: 'Tax', money: true },
  { key: 'netSales', label: 'Net Sales', money: true },
  { key: 'billed', label: 'Billed', num: true },
  { key: 'unbilled', label: 'UnBilled', num: true },
  { key: 'delivered', label: 'Delivered', num: true },
  { key: 'rto', label: 'RTO', num: true },
  { key: 'undelivered', label: 'Undelivered', num: true },
  { key: 'pending', label: 'Pending', num: true },
  { key: 'cashReceived', label: 'Cash Recd', money: true },
  { key: 'outstanding', label: 'Outstanding', money: true },
];
const money = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };

export function SalesMis() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Awaited<ReturnType<typeof api.misSales>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setBusy(true); setError('');
    api.misSales(from, to).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (r: any, c: typeof COLS[number]) => (c.money ? money(r[c.key]) : c.num ? Number(r[c.key] || 0).toLocaleString('en-IN') : (r[c.key] ?? ''));

  const exportXls = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');
    const head = COLS.map((c) => c.label);
    const body = data.rows.map((r) => COLS.map((c) => (c.money || c.num ? Number((r as any)[c.key] || 0) : (r as any)[c.key] ?? '')));
    const totalRow = COLS.map((c) => (c.key === 'code' ? 'TOTAL' : c.money || c.num ? Number((data.totals as any)[c.key] || 0) : ''));
    const ws = XLSX.utils.aoa_to_sheet([[`Sales MIS ${from} → ${to}`], head, ...body, totalRow]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sales MIS');
    XLSX.writeFile(wb, `sales-mis-${from}_${to}.xlsx`);
  };

  return (
    <>
      <h1>📈 Sales MIS</h1>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : '🔍 Search'}</button>
          <button className="secondary" onClick={exportXls} disabled={!data?.rows.length}>⬇ Excel</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Per-customer sales, weights, status and receivables for the period. Sales come from billed AWBs; outstanding is the live balance.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{data.count} customer(s) · {new Date(data.from).toLocaleDateString('en-GB')} → {new Date(data.to).toLocaleDateString('en-GB')}</div>
          <table style={{ minWidth: 1500, fontSize: 12.5 }}>
            <thead><tr>{COLS.map((c) => <th key={c.key} style={{ whiteSpace: 'nowrap', textAlign: c.money || c.num ? 'right' : 'left' }}>{c.label}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.code || r.customer}>
                  {COLS.map((c) => <td key={c.key} style={{ whiteSpace: 'nowrap', textAlign: c.money || c.num ? 'right' : 'left' }}>{cell(r, c)}</td>)}
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={COLS.length} className="muted" style={{ textAlign: 'center', padding: 18 }}>No shipments in this period.</td></tr>}
              {data.rows.length > 0 && (
                <tr style={{ fontWeight: 800, background: 'var(--surface-2, #f1f3f6)' }}>
                  {COLS.map((c) => <td key={c.key} style={{ whiteSpace: 'nowrap', textAlign: c.money || c.num ? 'right' : 'left' }}>{c.key === 'code' ? 'TOTAL' : c.money ? money((data.totals as any)[c.key]) : c.num ? Number((data.totals as any)[c.key] || 0).toLocaleString('en-IN') : ''}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
