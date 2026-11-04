import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Filter = 'customer' | 'vendor';
const REPORTS: { group: string; items: { key: string; label: string; noDate?: boolean; filters?: Filter[] }[] }[] = [
  { group: 'Operations', items: [
    { key: 'MIS', label: 'MIS Report' },
    { key: 'DELIVERY_STATUS', label: 'Delivery Status', filters: ['customer', 'vendor'] },
    { key: 'MANIFEST', label: 'Manifest Report' },
    { key: 'PICKUP', label: 'Pickup Report' },
    { key: 'DRS', label: 'DRS Report' },
    { key: 'ACTION_LOG', label: 'Action Log' },
    { key: 'LOGIN_LOG', label: 'Login Log' },
  ] },
  { group: 'Scan', items: [
    { key: 'SCAN', label: 'Scan Report' },
    { key: 'INSCAN', label: 'Inscan Report' },
    { key: 'NOT_INSCAN', label: 'Not Inscan' },
    { key: 'RUNSHEET_NOT_POD', label: 'Runsheet Not POD' },
    { key: 'COMMENT_VIEW', label: 'Comment View' },
    { key: 'VOLUMETRIC', label: 'Volumetric Weight' },
  ] },
  { group: 'Statements', items: [
    { key: 'DAILY', label: 'Daily Report' },
    { key: 'CUSTOMER_SUMMARY', label: 'Customer Summary' },
    { key: 'PRODUCT_SUMMARY', label: 'Product Summary', filters: ['customer', 'vendor'] },
    { key: 'DESTINATION_SUMMARY', label: 'Destination Summary' },
    { key: 'LOCATION_SUMMARY', label: 'Location Summary' },
    { key: 'CUSTOMER_REGISTER', label: 'Customer Register' },
    { key: 'VENDOR', label: 'Vendor Report', filters: ['customer', 'vendor'] },
    { key: 'TARIFF', label: 'Tariff Rate', noDate: true },
  ] },
  { group: 'AWB / Finance', items: [
    { key: 'BILLING', label: 'Billing Report', filters: ['customer', 'vendor'] },
    { key: 'EXTRA_EXPENSE', label: 'Extra Expense (AWB-wise)', filters: ['customer'] },
    { key: 'MISSING_AWB', label: 'Missing AWB (no forwarding no)', filters: ['customer', 'vendor'] },
    { key: 'AWB_GAPS', label: 'AWB Series Gaps' },
    { key: 'INVOICE', label: 'Invoice Report', noDate: true },
    { key: 'VOID', label: 'Void Report' },
    { key: 'ZERO', label: 'Zero Freight', filters: ['customer', 'vendor'] },
  ] },
  { group: 'AR', items: [
    { key: 'RECEIVABLES', label: 'Receivables (Outstanding)', noDate: true },
    { key: 'LEDGER_AGING', label: 'Ledger Aging', noDate: true },
  ] },
  { group: 'SLA', items: [
    { key: 'SLA', label: 'On-time / Delay (vendor × product)', filters: ['customer', 'vendor'] },
    { key: 'SLA_DETAIL', label: 'SLA — per AWB', filters: ['customer', 'vendor'] },
  ] },
];
const ALL = REPORTS.flatMap((g) => g.items);
const iso = (d: Date) => d.toISOString().slice(0, 10);
type Data = { columns: { key: string; label: string }[]; rows: any[]; note?: string; title?: string };
const isNum = (v: any) => v !== '' && v != null && !Number.isNaN(Number(String(v).replace(/[,%₹]/g, '')));
// rows that close a report (totals / summaries) stay at the bottom when sorting and searching
const isFooter = (r: any) => r._summary || Object.values(r).some((v) => v === 'TOTAL' || String(v).startsWith('SUMMARY'));

export function Reports() {
  const [type, setType] = useState('MIS');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [clientId, setClientId] = useState('');
  const [vendor, setVendor] = useState('');
  const [customers, setCustomers] = useState<{ id: string; accountCode: string; legalName: string }[]>([]);
  const [vendors, setVendors] = useState<{ code: string; name: string }[]>([]);
  const [data, setData] = useState<Data | null>(null);
  const [drill, setDrill] = useState<{ label: string; data: Data | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const def = ALL.find((r) => r.key === type)!;
  const filters = def.filters ?? [];

  useEffect(() => {
    api.bookingCustomers().then((cs: any[]) => setCustomers(cs.map((c) => ({ id: String(c.id), accountCode: c.accountCode, legalName: c.legalName })))).catch(() => {});
    api.listVendors().then((v: any[]) => setVendors(v.map((x) => ({ code: x.vendorCode, name: x.name })))).catch(() => {});
  }, []);

  const extra = () => ({ clientId: filters.includes('customer') ? clientId : '', vendor: filters.includes('vendor') ? vendor : '' });
  const run = async () => {
    setBusy(true); setError(''); setDrill(null);
    try { setData(await api.runReport(type, def.noDate ? undefined : from, def.noDate ? undefined : to, extra())); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { setSort(null); setQ(''); run(); /* eslint-disable-next-line */ }, [type]);

  const openDrill = async (r: any) => {
    if (!r._drill) return;
    const label = String(Object.values(r)[0] ?? '');
    setDrill({ label, data: null });
    try { setDrill({ label, data: await api.runReport(r._drill.type, from, to, { ...extra(), status: r._drill.status }) }); }
    catch (e: any) { setError(e.message); setDrill(null); }
  };

  const [digest, setDigest] = useState<any>(null);
  const emailDigest = async () => {
    setError('');
    try { setDigest(await api.emailDailyDigest()); } catch (e: any) { setError(e.message); }
  };

  const shown = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    let body = data.rows.filter((r) => !isFooter(r));
    const foot = data.rows.filter(isFooter);
    if (term) body = body.filter((r) => data.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(term)));
    if (sort) {
      body = [...body].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        const c = isNum(x) && isNum(y) ? Number(String(x).replace(/[,%₹]/g, '')) - Number(String(y).replace(/[,%₹]/g, '')) : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true });
        return c * sort.dir;
      });
    }
    return [...body, ...(term ? [] : foot)];
  }, [data, q, sort]);

  const download = async (d: Data, rows: any[], name: string) => {
    const XLSX = await import('xlsx');
    const cols = d.columns.filter((c) => !c.key.startsWith('_'));
    const aoa = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => { const v = r[c.key]; return isNum(v) && !/^0\d/.test(String(v)) && String(v).length < 15 ? Number(String(v).replace(/[,₹]/g, '')) : v ?? ''; }))];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 30));
    XLSX.writeFile(wb, `logimart-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${from}_${to}.xlsx`);
  };

  // Extra Expense report actions — the row moves into the matching summary line on refresh.
  const expenseAct = async (r: any, action: 'billed' | 'rejected' | 'reset') => {
    let ref: string | undefined;
    if (action === 'billed') { const v = window.prompt(`Mark ${r.awb} ₹${r.amount} (${r.reason}) as BILLED?\n\nInvoice / reference no. (optional):`, ''); if (v == null) return; ref = v; }
    if (action === 'rejected' && !window.confirm(`${r.awb} ₹${r.amount} (${r.reason}) — the customer rejected it? It will not be billed.`)) return;
    try { await api.extraExpenseAction(r._addonId, action, ref); await run(); } catch (e: any) { setError(e.message); }
  };

  const table = (d: Data, rows: any[], clickable: boolean, sortable: boolean) => (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr>{d.columns.map((c) => (
          <th key={c.key} style={{ cursor: sortable ? 'pointer' : undefined, whiteSpace: 'nowrap' }} title={sortable ? 'Sort' : undefined}
            onClick={sortable ? () => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })) : undefined}>
            {c.label}{sortable && sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
          </th>
        ))}</tr></thead>
        <tbody>
          {rows.slice(0, 1000).map((r, i) => (
            <tr key={i} onClick={clickable && r._drill ? () => openDrill(r) : undefined}
              style={{ cursor: clickable && r._drill ? 'pointer' : undefined, fontWeight: isFooter(r) ? 700 : undefined, background: isFooter(r) ? 'var(--surface-2, #f1f3f6)' : undefined }}>
              {d.columns.map((c) => c.key === '_action' ? (
                <td key={c.key} style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  {r._can === 'act' && <>
                    <button style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => expenseAct(r, 'billed')}>Billed</button>{' '}
                    <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => expenseAct(r, 'rejected')}>Rejected by customer</button>
                  </>}
                  {r._can === 'undo' && <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => expenseAct(r, 'reset')}>Undo</button>}
                </td>
              ) : <td key={c.key} style={{ whiteSpace: 'nowrap', textAlign: isNum(r[c.key]) ? 'right' : 'left', textDecoration: clickable && r._drill && c === d.columns[0] ? 'underline' : undefined }}>{String(r[c.key] ?? (isFooter(r) ? '' : '—'))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <h1>📊 Reports</h1>

      <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div><strong>📧 Daily digest (NDR + MIS)</strong><div className="muted" style={{ fontSize: 12 }}>Today's bookings/deliveries, open NDR, revenue & receivables — emailed to your reports recipients.</div></div>
          <button className="secondary" onClick={emailDigest}>Email daily digest now</button>
        </div>
        {digest && (
          <div className="card" style={{ marginTop: 10, background: 'var(--bg-soft, #f2f4f7)' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>{digest.message}</pre>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Queued to: {digest.sentTo?.join(', ')}. {digest.note}</div>
          </div>
        )}
      </div>

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
        <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            {!def.noDate && (
              <>
                <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              </>
            )}
            {filters.includes('customer') && (
              <div style={{ minWidth: 220 }}><label>Customer</label>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">All customers</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
                </select>
              </div>
            )}
            {filters.includes('vendor') && (
              <div style={{ minWidth: 180 }}><label>Vendor</label>
                <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
                  <option value="">All vendors</option>
                  {vendors.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={run} disabled={busy}>{busy ? 'Running…' : '▶ Run'}</button>
          </div>
          {data && data.rows.length > 0 && (
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter rows…" style={{ width: 180 }} /></div>
              <button className="secondary" onClick={() => download(data, shown, def.label)}>⬇ Excel</button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {data && (
        <div className="card">
          <h2>{data.title ?? def.label} — {shown.filter((r) => !isFooter(r)).length} row(s){q.trim() ? ` matching "${q.trim()}"` : ''}</h2>
          {data.note && <p className="muted" style={{ marginTop: -6, fontSize: 12.5 }}>{data.note}</p>}
          {table(data, shown, true, true)}
          {data.rows.length === 0 && <p className="muted">No data for this range.</p>}
          {shown.length > 1000 && <p className="muted">Showing the first 1,000 of {shown.length.toLocaleString('en-IN')} rows — download Excel for all of them.</p>}
        </div>
      )}

      {drill && (
        <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{drill.data?.title ?? drill.label} {drill.data ? `— ${drill.data.rows.length} AWB(s)` : '— loading…'}</h2>
            <div className="row" style={{ gap: 8 }}>
              {drill.data && drill.data.rows.length > 0 && <button className="secondary" onClick={() => download(drill.data!, drill.data!.rows, drill.data!.title ?? drill.label)}>⬇ Excel</button>}
              <button className="secondary" onClick={() => setDrill(null)}>Close</button>
            </div>
          </div>
          {drill.data && table(drill.data, drill.data.rows, false, false)}
          {drill.data && drill.data.rows.length > 1000 && <p className="muted">Showing the first 1,000 — download Excel for all of them.</p>}
        </div>
      )}
    </>
  );
}
