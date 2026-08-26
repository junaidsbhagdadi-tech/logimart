import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const TABS = ['Customer Service', 'Sales', 'Operations'] as const;
type Tab = (typeof TABS)[number];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const money = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d10 = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export function TeamDashboards() {
  const [tab, setTab] = useState<Tab>('Customer Service');
  return (
    <>
      <h1>📊 Team Dashboards</h1>
      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {TABS.map((t) => <button key={t} className={tab === t ? '' : 'secondary'} style={{ padding: '8px 16px' }} onClick={() => setTab(t)}>{t === 'Customer Service' ? '🎧 ' : t === 'Sales' ? '💰 ' : '🛠 '}{t}</button>)}
        </div>
      </div>
      {tab === 'Customer Service' && <CS />}
      {tab === 'Sales' && <Sales />}
      {tab === 'Operations' && <Ops />}
    </>
  );
}

/** CS — pending / stuck shipments, NDR, overdue; the queue to chase and send NDR reports on. */
function CS() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Awaited<ReturnType<typeof api.csDashboard>> | null>(null);
  const [filter, setFilter] = useState<'all' | 'ndr' | 'overdue'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setBusy(true); setError(''); api.csDashboard(from, to).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = (data?.rows ?? []).filter((r) => filter === 'all' || (filter === 'ndr' ? r.ndr : r.overdue));
  const exportXls = async () => {
    const XLSX = await import('xlsx');
    const head = ['AWB', 'Customer', 'Consignee', 'Phone', 'Destination', 'Status', 'Age (days)', 'EDD', 'Overdue', 'NDR', 'Remark'];
    const body = rows.map((r) => [r.awb, r.customer, r.consignee, r.phone, r.destination, r.status, r.ageDays, d10(r.edd), r.overdue ? 'YES' : '', r.ndr ? 'YES' : '', r.remark ?? '']);
    const ws = XLSX.utils.aoa_to_sheet([['NDR / Pending report'], head, ...body]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'CS');
    XLSX.writeFile(wb, `cs-pending-${from}_${to}.xlsx`);
  };
  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : '🔍 Search'}</button>
          <button className="secondary" onClick={exportXls} disabled={!rows.length}>⬇ NDR / pending report</button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <>
          <div className="row" style={{ gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
            {([['all', `Pending: ${data.count}`], ['ndr', `NDR: ${data.ndrCount}`], ['overdue', `Overdue: ${data.overdueCount}`]] as const).map(([k, label]) => (
              <button key={k} className={filter === k ? '' : 'secondary'} style={{ padding: '6px 12px', ...(k === 'ndr' && data.ndrCount ? { color: 'var(--danger,#c0392b)' } : {}) }} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 1100, fontSize: 12.5 }}>
              <thead><tr><th>AWB</th><th>Customer</th><th>Consignee</th><th>Phone</th><th>Destination</th><th>Status</th><th style={{ textAlign: 'right' }}>Age</th><th>EDD</th><th>Remark</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.awb} style={r.ndr ? { background: '#fdecea' } : r.overdue ? { background: '#fff6e6' } : undefined}>
                    <td><Link to={`/tracker/${r.awb}`}><strong>{r.awb}</strong></Link></td>
                    <td>{r.customer}</td><td>{r.consignee || '—'}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '—'}</td>
                    <td>{r.destination}</td>
                    <td>{r.status}{r.ndr ? ' · NDR' : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: r.ageDays > 5 ? 800 : 400, color: r.ageDays > 5 ? 'var(--danger,#c0392b)' : undefined }}>{r.ageDays}d</td>
                    <td style={{ color: r.overdue ? 'var(--danger,#c0392b)' : undefined }}>{d10(r.edd)}</td>
                    <td>{r.remark || '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 18 }}>Nothing pending in this range 🎉</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** Sales — per-salesperson contribution incl. unbilled (live-rated). */
function Sales() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Awaited<ReturnType<typeof api.salesByRep>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setBusy(true); setError(''); api.salesByRep(from, to).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="secondary" onClick={() => { setFrom(monthStart()); setTo(today()); }}>This month</button>
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : '🔍 Search'}</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Contribution per salesperson (their assigned customers), including <strong>unbilled</strong> (live-rated) sales.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 900 }}>
            <thead><tr><th>Salesperson</th><th>Contact</th><th style={{ textAlign: 'right' }}>Shipments</th><th style={{ textAlign: 'right' }}>Billed</th><th style={{ textAlign: 'right' }}>Unbilled</th><th style={{ textAlign: 'right' }}>Billed ₹</th><th style={{ textAlign: 'right' }}>Unbilled ₹</th><th style={{ textAlign: 'right' }}>Total ₹</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.salesPerson}>
                  <td><strong>{r.salesPerson}</strong></td>
                  <td className="muted" style={{ fontSize: 12 }}>{[r.mobile, r.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.shipments}</td>
                  <td style={{ textAlign: 'right' }}>{r.billedCount}</td>
                  <td style={{ textAlign: 'right' }}>{r.unbilledCount}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.billedSales)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--warn,#b26a00)' }}>{money(r.unbilledSales)}</td>
                  <td style={{ textAlign: 'right' }}><strong>{money(r.totalSales)}</strong></td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 18 }}>No shipments in this range.</td></tr>}
              {data.rows.length > 0 && (
                <tr style={{ fontWeight: 800, background: 'var(--surface-2,#f1f3f6)' }}>
                  <td>TOTAL</td><td></td><td style={{ textAlign: 'right' }}>{data.totals.shipments}</td><td style={{ textAlign: 'right' }}>{data.totals.billedCount}</td><td style={{ textAlign: 'right' }}>{data.totals.unbilledCount}</td>
                  <td style={{ textAlign: 'right' }}>{money(data.totals.billedSales)}</td><td style={{ textAlign: 'right' }}>{money(data.totals.unbilledSales)}</td><td style={{ textAlign: 'right' }}>{money(data.totals.totalSales)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Ops — task buckets by milestone stage; click a bucket to see the shipments. */
function Ops() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.opsDashboard>> | null>(null);
  const [drill, setDrill] = useState<{ code: string; label: string; rows: any[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.opsDashboard().then(setData).catch((e) => setError(e.message)); }, []);
  const openBucket = async (b: { key: string; label: string }) => {
    try { const rows = await api.opsBucket(b.key); setDrill({ code: b.key, label: b.label, rows }); } catch (e: any) { setError(e.message); }
  };
  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        {(data?.buckets ?? []).map((b) => (
          <button key={b.key} className="card" onClick={() => openBucket(b)} style={{ cursor: 'pointer', minWidth: 170, textAlign: 'left', border: drill?.code === b.key ? '2px solid var(--brand)' : undefined }}>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.4px' }}>{b.label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: b.key === 'UDL' || b.key === 'RTO' ? 'var(--danger,#c0392b)' : 'var(--brand)' }}>{b.count}</div>
          </button>
        ))}
      </div>
      {drill && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2 style={{ marginBottom: 8 }}>{drill.label} <span className="muted" style={{ fontSize: 13 }}>({drill.rows.length})</span></h2>
          <table style={{ minWidth: 800, fontSize: 12.5 }}>
            <thead><tr><th>AWB</th><th>Customer</th><th>Destination</th><th>Location</th><th>Since</th></tr></thead>
            <tbody>
              {drill.rows.map((r) => (
                <tr key={r.awb}><td><Link to={`/tracker/${r.awb}`}><strong>{r.awb}</strong></Link></td><td>{r.customer}</td><td>{r.destination}</td><td>{r.location || '—'}</td><td>{r.at ? new Date(r.at).toLocaleString('en-IN') : '—'}</td></tr>
              ))}
              {drill.rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 16 }}>Empty.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
