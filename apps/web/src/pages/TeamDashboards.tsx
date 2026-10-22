import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const TABS = ['Customer Service', 'Sales', 'Operations'] as const;
type Tab = (typeof TABS)[number];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const money = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d10 = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

type Filt = { vendor: string; clientId: string };
type Opt = { value: string; label: string };

/** Customer + vendor option lists for the filter bar (loaded once; empty if the role can't list them). */
function useFilterOptions() {
  const [customers, setCustomers] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);
  useEffect(() => {
    api.listClients().then((cs: any[]) => setCustomers(cs.map((c) => ({ value: String(c.id), label: `${c.legalName} (${c.accountCode})` })).sort((a, b) => a.label.localeCompare(b.label)))).catch(() => {});
    api.listVendors().then((vs: any[]) => setVendors(vs.filter((v) => v.isActive !== false).map((v) => ({ value: v.vendorCode, label: `${v.vendorCode} — ${v.name}` })).sort((a, b) => a.label.localeCompare(b.label)))).catch(() => {});
  }, []);
  return { customers, vendors };
}

/** Vendor-wise + customer-wise filter used on every tab. */
function FilterBar({ f, setF, opts }: { f: Filt; setF: (f: Filt) => void; opts: { customers: Opt[]; vendors: Opt[] } }) {
  return (
    <>
      <div>
        <label>Vendor</label>
        <select value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} style={{ minWidth: 170 }}>
          <option value="">All vendors</option>
          <option value="SELF">SELF (own network)</option>
          {opts.vendors.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </div>
      <div>
        <label>Customer</label>
        <select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} style={{ minWidth: 220, maxWidth: 300 }}>
          <option value="">All customers</option>
          {opts.customers.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    </>
  );
}

/** Excel download helper: a title row, a header row, then the data. */
async function downloadXlsx(name: string, title: string, head: string[], body: (string | number)[][]) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([[title], head, ...body]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, name);
}

const filtLabel = (f: Filt, opts: { customers: Opt[]; vendors: Opt[] }) => [
  f.vendor ? `Vendor: ${f.vendor}` : '',
  f.clientId ? `Customer: ${opts.customers.find((c) => c.value === f.clientId)?.label ?? f.clientId}` : '',
].filter(Boolean).join(' · ');

export function TeamDashboards() {
  const [tab, setTab] = useState<Tab>('Customer Service');
  const opts = useFilterOptions();
  return (
    <>
      <h1>📊 Team Dashboards</h1>
      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {TABS.map((t) => <button key={t} className={tab === t ? '' : 'secondary'} style={{ padding: '8px 16px' }} onClick={() => setTab(t)}>{t === 'Customer Service' ? '🎧 ' : t === 'Sales' ? '💰 ' : '🛠 '}{t}</button>)}
        </div>
      </div>
      {tab === 'Customer Service' && <CS opts={opts} />}
      {tab === 'Sales' && <Sales opts={opts} />}
      {tab === 'Operations' && <Ops opts={opts} />}
    </>
  );
}

/** CS — pending / stuck shipments, NDR, overdue; the queue to chase and send NDR reports on. */
function CS({ opts }: { opts: { customers: Opt[]; vendors: Opt[] } }) {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const [f, setF] = useState<Filt>({ vendor: '', clientId: '' });
  const [data, setData] = useState<Awaited<ReturnType<typeof api.csDashboard>> | null>(null);
  const [filter, setFilter] = useState<'all' | 'ndr' | 'overdue'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setBusy(true); setError(''); api.csDashboard(from, to, f).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = (data?.rows ?? []).filter((r) => filter === 'all' || (filter === 'ndr' ? r.ndr : r.overdue));
  const exportXls = () => downloadXlsx(
    `cs-pending-${from}_${to}${f.vendor ? '-' + f.vendor : ''}.xlsx`,
    `NDR / Pending report ${from} → ${to}${filtLabel(f, opts) ? ' · ' + filtLabel(f, opts) : ''}`,
    ['AWB', 'Booked', 'Picked', 'Customer', 'Code', 'Vendor', 'Forwarding No', 'Consignee', 'Phone', 'Destination', 'Status', 'Age (days)', 'EDD', 'Overdue', 'NDR', 'Remark'],
    rows.map((r) => [r.awb, d10(r.bookedAt), d10(r.pickedAt), r.customer, r.code, r.vendor || 'SELF', r.forwardingAwb, r.consignee, r.phone, r.destination, r.status, r.ageDays, d10(r.edd), r.overdue ? 'YES' : '', r.ndr ? 'YES' : '', r.remark ?? '']),
  );
  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <FilterBar f={f} setF={setF} opts={opts} />
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : '🔍 Search'}</button>
          <button className="secondary" onClick={exportXls} disabled={!rows.length}>⬇ Excel</button>
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
            <table style={{ minWidth: 1350, fontSize: 12.5 }}>
              <thead><tr><th>AWB</th><th>Customer</th><th>Vendor</th><th>Booked</th><th>Picked</th><th>Consignee</th><th>Phone</th><th>Destination</th><th>Status</th><th style={{ textAlign: 'right' }}>Age</th><th>EDD</th><th>Remark</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.awb} style={r.ndr ? { background: '#fdecea' } : r.overdue ? { background: '#fff6e6' } : undefined}>
                    <td><Link to={`/tracker/${r.awb}`}><strong>{r.awb}</strong></Link></td>
                    <td>{r.customer}<div className="muted" style={{ fontSize: 11 }}>{r.code}</div></td>
                    <td>{r.vendor || 'SELF'}{r.forwardingAwb ? <div className="muted" style={{ fontSize: 11 }}>{r.forwardingAwb}</div> : null}</td>
                    <td>{d10(r.bookedAt)}</td>
                    <td>{r.pickedAt ? d10(r.pickedAt) : <span className="muted">not yet</span>}</td>
                    <td>{r.consignee || '—'}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '—'}</td>
                    <td>{r.destination}</td>
                    <td>{r.status}{r.ndr ? ' · NDR' : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: r.ageDays > 5 ? 800 : 400, color: r.ageDays > 5 ? 'var(--danger,#c0392b)' : undefined }}>{r.ageDays}d</td>
                    <td style={{ color: r.overdue ? 'var(--danger,#c0392b)' : undefined }}>{d10(r.edd)}</td>
                    <td>{r.remark || '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={12} className="muted" style={{ textAlign: 'center', padding: 18 }}>Nothing pending in this range 🎉</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** Sales — contribution grouped by salesperson / customer / vendor, incl. unbilled (live-rated). */
function Sales({ opts }: { opts: { customers: Opt[]; vendors: Opt[] } }) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [f, setF] = useState<Filt>({ vendor: '', clientId: '' });
  const [groupBy, setGroupBy] = useState<'rep' | 'customer' | 'vendor'>('rep');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.salesByRep>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = (g = groupBy) => { setBusy(true); setError(''); api.salesByRep(from, to, { ...f, groupBy: g }).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const g = (data?.groupBy as typeof groupBy) || groupBy;
  const firstCol = g === 'customer' ? 'Customer' : g === 'vendor' ? 'Vendor' : 'Salesperson';
  const nameOf = (r: any) => (g === 'customer' ? `${r.customer}${r.accountCode ? ` (${r.accountCode})` : ''}` : g === 'vendor' ? r.vendor : r.salesPerson);
  const exportXls = () => {
    if (!data) return;
    const head = [firstCol, ...(g === 'rep' ? ['Mobile', 'Email'] : g === 'customer' ? ['Salesperson'] : []), 'Shipments', 'Billed', 'Unbilled', 'Billed ₹', 'Unbilled ₹', 'Total ₹'];
    const body = data.rows.map((r: any) => [nameOf(r), ...(g === 'rep' ? [r.mobile, r.email] : g === 'customer' ? [r.salesPerson] : []), r.shipments, r.billedCount, r.unbilledCount, r.billedSales, r.unbilledSales, r.totalSales]);
    const t = data.totals;
    body.push(['TOTAL', ...(g === 'rep' ? ['', ''] : g === 'customer' ? [''] : []), t.shipments, t.billedCount, t.unbilledCount, t.billedSales, t.unbilledSales, t.totalSales]);
    downloadXlsx(`sales-by-${g}-${from}_${to}.xlsx`, `Sales by ${firstCol.toLowerCase()} ${from} → ${to}${filtLabel(f, opts) ? ' · ' + filtLabel(f, opts) : ''}`, head, body);
  };
  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="secondary" onClick={() => { setFrom(monthStart()); setTo(today()); }}>This month</button>
          <FilterBar f={f} setF={setF} opts={opts} />
          <div>
            <label>Group by</label>
            <select value={groupBy} onChange={(e) => { const v = e.target.value as typeof groupBy; setGroupBy(v); load(v); }}>
              <option value="rep">Salesperson</option><option value="customer">Customer</option><option value="vendor">Vendor</option>
            </select>
          </div>
          <button onClick={() => load()} disabled={busy}>{busy ? 'Loading…' : '🔍 Search'}</button>
          <button className="secondary" onClick={exportXls} disabled={!data?.rows.length}>⬇ Excel</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Contribution by {firstCol.toLowerCase()}, including <strong>unbilled</strong> (live-rated) sales. A month can take a minute — every unbilled shipment is priced.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {data?.truncated && <div className="card" style={{ borderLeft: '4px solid var(--warn,#d97706)', fontSize: 13 }}>⚠ Capped at 20,000 shipments — narrow the range or pick a customer/vendor.</div>}
      {data && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 900 }}>
            <thead><tr><th>{firstCol}</th>{g === 'rep' && <th>Contact</th>}{g === 'customer' && <th>Salesperson</th>}<th style={{ textAlign: 'right' }}>Shipments</th><th style={{ textAlign: 'right' }}>Billed</th><th style={{ textAlign: 'right' }}>Unbilled</th><th style={{ textAlign: 'right' }}>Billed ₹</th><th style={{ textAlign: 'right' }}>Unbilled ₹</th><th style={{ textAlign: 'right' }}>Total ₹</th></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.key ?? r.salesPerson}>
                  <td><strong>{nameOf(r)}</strong></td>
                  {g === 'rep' && <td className="muted" style={{ fontSize: 12 }}>{[r.mobile, r.email].filter(Boolean).join(' · ') || '—'}</td>}
                  {g === 'customer' && <td className="muted" style={{ fontSize: 12 }}>{r.salesPerson}</td>}
                  <td style={{ textAlign: 'right' }}>{r.shipments}</td>
                  <td style={{ textAlign: 'right' }}>{r.billedCount}</td>
                  <td style={{ textAlign: 'right' }}>{r.unbilledCount}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.billedSales)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--warn,#b26a00)' }}>{money(r.unbilledSales)}</td>
                  <td style={{ textAlign: 'right' }}><strong>{money(r.totalSales)}</strong></td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 18 }}>No shipments in this range.</td></tr>}
              {data.rows.length > 0 && (
                <tr style={{ fontWeight: 800, background: 'var(--surface-2,#f1f3f6)' }}>
                  <td>TOTAL</td>{g !== 'vendor' && <td></td>}<td style={{ textAlign: 'right' }}>{data.totals.shipments}</td><td style={{ textAlign: 'right' }}>{data.totals.billedCount}</td><td style={{ textAlign: 'right' }}>{data.totals.unbilledCount}</td>
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
function Ops({ opts }: { opts: { customers: Opt[]; vendors: Opt[] } }) {
  const [f, setF] = useState<Filt>({ vendor: '', clientId: '' });
  const [data, setData] = useState<Awaited<ReturnType<typeof api.opsDashboard>> | null>(null);
  const [drill, setDrill] = useState<{ code: string; label: string; rows: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => {
    setBusy(true); setError('');
    api.opsDashboard(f).then((d) => { setData(d); if (drill) openBucket({ key: drill.code, label: drill.label }); }).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openBucket = async (b: { key: string; label: string }) => {
    try { const rows = await api.opsBucket(b.key, f); setDrill({ code: b.key, label: b.label, rows }); } catch (e: any) { setError(e.message); }
  };
  const exportXls = () => {
    if (!drill) return;
    downloadXlsx(`ops-${drill.code}${f.vendor ? '-' + f.vendor : ''}.xlsx`, `${drill.label}${filtLabel(f, opts) ? ' · ' + filtLabel(f, opts) : ''}`,
      ['AWB', 'Booked', 'Customer', 'Code', 'Vendor', 'Forwarding No', 'Destination', 'Location', 'Status', 'Since'],
      drill.rows.map((r) => [r.awb, d10(r.bookedAt), r.customer, r.code, r.vendor || 'SELF', r.forwardingAwb, r.destination, r.location || '', r.status, r.at ? new Date(r.at).toLocaleString('en-IN') : '']));
  };
  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FilterBar f={f} setF={setF} opts={opts} />
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : '🔍 Apply'}</button>
          <button className="secondary" onClick={exportXls} disabled={!drill?.rows.length} title={drill ? '' : 'Open a bucket first'}>⬇ Excel{drill ? ` (${drill.label})` : ''}</button>
        </div>
      </div>
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
          <table style={{ minWidth: 900, fontSize: 12.5 }}>
            <thead><tr><th>AWB</th><th>Customer</th><th>Vendor</th><th>Destination</th><th>Location</th><th>Since</th></tr></thead>
            <tbody>
              {drill.rows.map((r) => (
                <tr key={r.awb}>
                  <td><Link to={`/tracker/${r.awb}`}><strong>{r.awb}</strong></Link></td>
                  <td>{r.customer}<div className="muted" style={{ fontSize: 11 }}>{r.code}</div></td>
                  <td>{r.vendor || 'SELF'}{r.forwardingAwb ? <div className="muted" style={{ fontSize: 11 }}>{r.forwardingAwb}</div> : null}</td>
                  <td>{r.destination}</td><td>{r.location || '—'}</td><td>{r.at ? new Date(r.at).toLocaleString('en-IN') : '—'}</td>
                </tr>
              ))}
              {drill.rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>Empty.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
