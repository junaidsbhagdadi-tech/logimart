import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate, fmtDateTime } from '../format';

const TABS = ['Customer Service', 'Sales', 'Operations'] as const;
type Tab = (typeof TABS)[number];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const money = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d10 = (v: any) => (v ? fmtDate(v) : '—');

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
/** #14-5 Pick several vendors / customers, with a search box. Value = comma-separated. */
function MultiPick({ label, value, onChange, options, allLabel, width }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; allLabel: string; width: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sel = value ? value.split(',').filter(Boolean) : [];
  const toggle = (v: string) => onChange((sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]).join(','));
  const shown = options.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const text = sel.length === 0 ? allLabel : sel.length === 1 ? (options.find((o) => o.value === sel[0])?.label ?? sel[0]) : `${sel.length} selected`;
  return (
    <div style={{ position: 'relative' }}>
      <label>{label}</label>
      <button type="button" className="secondary" onClick={() => setOpen((o) => !o)} style={{ minWidth: width, maxWidth: 320, textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: sel.length ? 600 : 400 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span><span>▾</span>
      </button>
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />}
      {open && (
        <div style={{ position: 'absolute', zIndex: 50, top: '100%', left: 0, marginTop: 4, width: Math.max(width, 300), background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: 8 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
          <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: 6 }}>
            {shown.map((o) => (
              <label key={o.value} className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 400, fontSize: 13, padding: '4px 2px', cursor: 'pointer', margin: 0 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={sel.includes(o.value)} onChange={() => toggle(o.value)} />{o.label}
              </label>
            ))}
            {!shown.length && <div className="muted" style={{ fontSize: 12.5, padding: 6 }}>No match.</div>}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onChange('')}>Clear</button>
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{sel.length ? `${sel.length} picked` : ''}</span>
            <button type="button" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBar({ f, setF, opts }: { f: Filt; setF: (f: Filt) => void; opts: { customers: Opt[]; vendors: Opt[] } }) {
  return (
    <>
      <MultiPick label="Vendor" value={f.vendor} onChange={(v) => setF({ ...f, vendor: v })} options={[{ value: 'SELF', label: 'SELF (own network)' }, ...opts.vendors]} allLabel="All vendors" width={180} />
      <MultiPick label="Customer" value={f.clientId} onChange={(v) => setF({ ...f, clientId: v })} options={opts.customers} allLabel="All customers" width={230} />
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

const filtLabel = (f: Filt, opts: { customers: Opt[]; vendors: Opt[] }) => {
  const cs = f.clientId ? f.clientId.split(',').filter(Boolean).map((id) => opts.customers.find((c) => c.value === id)?.label ?? id) : [];
  return [
    f.vendor ? `Vendor: ${f.vendor.split(',').join(', ')}` : '',
    cs.length ? `Customer: ${cs.slice(0, 3).join(', ')}${cs.length > 3 ? ` +${cs.length - 3} more` : ''}` : '',
  ].filter(Boolean).join(' · ');
};

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
  // No date range: every open AWB stays on the list until it is delivered / returned / cancelled (or deleted).
  const [f, setF] = useState<Filt>({ vendor: '', clientId: '' });
  const [data, setData] = useState<Awaited<ReturnType<typeof api.csDashboard>> | null>(null);
  const [filter, setFilter] = useState<'all' | 'ndr' | 'exception' | 'overdue' | 'old'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => {
    setBusy(true); setError('');
    api.csDashboard(undefined, undefined, f).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false));
    // Exceptions summary (same buckets as the Exceptions page, minus "invoices not sent"), all open — no date window.
    api.exceptionsInbox(true, f).then((r) => setExc(r.buckets.filter((b) => b.key !== 'invoices_unsent'))).catch(() => setExc([]));
  };
  const [exc, setExc] = useState<{ key: string; title: string; hint: string; items: any[] }[] | null>(null);
  const [excOpen, setExcOpen] = useState<string | null>(null);
  const excHead = (k: string) => (k === 'pickups_waiting' ? ['Pickup #', 'Customer', 'Address', 'Vendor', 'Reason', 'Age (days)'] : ['AWB', 'Customer', 'Vendor', 'Carrier AWB', 'Status', 'Consignee', 'Destination', 'Reason', 'Age (days)', 'Booked']);
  const excRow = (k: string, i: any): (string | number)[] => (k === 'pickups_waiting'
    ? [i.pickupId, i.customer, i.address, i.vendor, i.reason, i.ageDays ?? '']
    : [i.awb, i.customer, i.vendor, i.carrierAwb ?? '', i.status, i.consignee, i.destination, i.reason, i.ageDays ?? '', d10(i.bookedAt)]);
  const excXls = async (only?: string) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const b of (exc ?? []).filter((x) => !only || x.key === only)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`${b.title} — ${b.items.length} open as on ${today()}`], excHead(b.key), ...b.items.map((i) => excRow(b.key, i))]), b.title.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 31));
    }
    XLSX.writeFile(wb, `cs-exceptions-${only ?? 'all'}-${today()}.xlsx`);
  };
  // #14-6 the list (and therefore the Excel) follows the filters the moment they change — picking a customer
  // used to need "Refresh", so the export carried every customer under that customer's title.
  useEffect(load, [f.vendor, f.clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('');
  const pick = (r: any) => filter === 'all' || (filter === 'ndr' ? r.ndr : filter === 'exception' ? r.exception : filter === 'old' ? r.ageDays > 30 : r.overdue);
  const oldCount = (data?.rows ?? []).filter((r: any) => r.ageDays > 30).length;
  const rows = (data?.rows ?? []).filter(pick)
    .filter((r: any) => !q.trim() || [r.awb, r.forwardingAwb, r.customer, r.code, r.consignee, r.phone, r.origin, r.destination, r.status, r.vendor, r.lastScan?.text, r.remark]
      .some((v) => String(v ?? '').toLowerCase().includes(q.trim().toLowerCase())));
  const scanAt = (v: any) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const exportXls = () => downloadXlsx(
    `cs-open-${today()}${f.vendor ? '-' + f.vendor : ''}.xlsx`,
    `NDR / Pending — all open as on ${today()}${filtLabel(f, opts) ? ' · ' + filtLabel(f, opts) : ''}`,
    ['AWB', 'Booked', 'Picked', 'Customer', 'Code', 'Vendor', 'Forwarding No', 'Consignee', 'Phone', 'Origin', 'Destination', 'Status', 'Last scan', 'Last scan at', 'Age (days)', 'EDD', 'Overdue', 'NDR', 'Remark'],
    rows.map((r: any) => [r.awb, d10(r.bookedAt), d10(r.pickedAt), r.customer, r.code, r.vendor || 'SELF', r.forwardingAwb, r.consignee, r.phone, r.origin ?? '', r.destination, r.status, r.lastScan?.text ?? '', scanAt(r.lastScan?.at), r.ageDays, d10(r.edd), r.overdue ? 'YES' : '', r.ndr ? 'YES' : '', r.remark ?? '']),
  );
  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FilterBar f={f} setF={setF} opts={opts} />
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : '⟳ Refresh'}</button>
          <button className="secondary" onClick={exportXls} disabled={!rows.length}>⬇ Excel</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Every open AWB, any booking date — it stays here until it is delivered, returned or cancelled.{data?.oldestAt ? ` Oldest open booking: ${d10(data.oldestAt)}.` : ''}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {exc && exc.length > 0 && (
        <div className="card" style={{ margin: '10px 0' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b>Exceptions summary</b>
            <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => excXls()}>⬇ Excel — all ({exc.reduce((a, b) => a + b.items.length, 0)})</button>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {exc.map((b) => (
              <button key={b.key} className={excOpen === b.key ? '' : 'secondary'} title={b.hint} style={{ padding: '6px 12px' }} onClick={() => setExcOpen(excOpen === b.key ? null : b.key)}>
                {b.title} <span style={{ marginLeft: 4, padding: '0 7px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, background: b.items.length ? '#fdecea' : '#e7f6ec', color: b.items.length ? '#b42318' : '#166534' }}>{b.items.length}</span>
              </button>
            ))}
          </div>
          {excOpen && (() => {
            const b = exc.find((x) => x.key === excOpen)!;
            return (
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>{b.hint}</span>
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => excXls(b.key)} disabled={!b.items.length}>⬇ Excel</button>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ fontSize: 12.5, minWidth: 900 }}>
                    <thead><tr>{excHead(b.key).map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {b.items.map((i, n) => (
                        <tr key={n}>{excRow(b.key, i).map((v, j) => <td key={j}>{j === 0 && b.key !== 'pickups_waiting' ? <Link to={`/tracker/${v}`}><strong>{v}</strong></Link> : v}</td>)}</tr>
                      ))}
                      {!b.items.length && <tr><td colSpan={excHead(b.key).length} className="muted" style={{ textAlign: 'center', padding: 14 }}>Nothing open 🎉</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      {data && (
        <>
          <div className="row" style={{ gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
            {([['all', `Pending: ${data.count}`], ['ndr', `NDR: ${data.ndrCount}`], ['exception', `Exceptions: ${data.exceptionCount ?? 0}`], ['overdue', `Overdue: ${data.overdueCount}`], ['old', `Open > 30 days: ${oldCount}`]] as const).map(([k, label]) => (
              <button key={k} className={filter === k ? '' : 'secondary'} title={k === 'exception' ? 'RTO in progress or a flagged remark' : k === 'old' ? 'Booked more than 30 days ago and still not closed' : undefined} style={{ padding: '6px 12px', ...((k === 'ndr' && data.ndrCount) || (k === 'exception' && data.exceptionCount) ? { color: 'var(--danger,#c0392b)' } : {}) }} onClick={() => setFilter(k)}>{label}</button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB / customer / consignee / city / status…" style={{ maxWidth: 320, marginLeft: 8 }} />
            {q && <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{rows.length} match</span>}
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 1350, fontSize: 12.5 }}>
              <thead><tr><th>AWB</th><th>Customer</th><th>Vendor</th><th>Booked</th><th>Picked</th><th>Consignee</th><th>Last scan</th><th>Phone</th><th>Origin</th><th>Destination</th><th>Status</th><th style={{ textAlign: 'right' }}>Age</th><th>EDD</th><th>Remark</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.awb} style={r.ndr ? { background: '#fdecea' } : r.overdue ? { background: '#fff6e6' } : undefined}>
                    <td><Link to={`/tracker/${r.awb}`}><strong>{r.awb}</strong></Link></td>
                    <td>{r.customer}<div className="muted" style={{ fontSize: 11 }}>{r.code}</div></td>
                    <td>{r.vendor || 'SELF'}{r.forwardingAwb ? <div className="muted" style={{ fontSize: 11 }}>{r.forwardingAwb}</div> : null}</td>
                    <td>{d10(r.bookedAt)}</td>
                    <td>{r.pickedAt ? d10(r.pickedAt) : <span className="muted">not yet</span>}</td>
                    <td>{r.consignee || '—'}</td>
                    <td style={{ maxWidth: 240 }}>{(r as any).lastScan ? <>{(r as any).lastScan.text}<div className="muted" style={{ fontSize: 11 }}>{[(r as any).lastScan.where, scanAt((r as any).lastScan.at)].filter(Boolean).join(' · ')}</div></> : '—'}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '—'}</td>
                    <td>{(r as any).origin || '—'}</td>
                    <td>{r.destination}</td>
                    <td>{r.status}{r.ndr ? ' · NDR' : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: r.ageDays > 5 ? 800 : 400, color: r.ageDays > 5 ? 'var(--danger,#c0392b)' : undefined }}>{r.ageDays}d</td>
                    <td style={{ color: r.overdue ? 'var(--danger,#c0392b)' : undefined }}>{d10(r.edd)}</td>
                    <td>{r.remark || '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={14} className="muted" style={{ textAlign: 'center', padding: 18 }}>{q ? 'Nothing matches the search.' : 'Nothing open 🎉'}</td></tr>}
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
      drill.rows.map((r) => [r.awb, d10(r.bookedAt), r.customer, r.code, r.vendor || 'SELF', r.forwardingAwb, r.destination, r.location || '', r.status, r.at ? fmtDateTime(r.at) : '']));
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
                  <td>{r.destination}</td><td>{r.location || '—'}</td><td>{r.at ? fmtDateTime(r.at) : '—'}</td>
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
