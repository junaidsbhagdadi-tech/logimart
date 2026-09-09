import { useEffect, useState } from 'react';
import { api, Client } from '../api';

/** Per-AWB bill working sheet (all charge heads) — matches the "Customer bill working"
 *  format exactly, viewable + exportable to Excel. */
export function BillWorksheet() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientIds, setClientIds] = useState<string[]>([]); // one or several selected
  const [allCustomers, setAllCustomers] = useState(false);  // ignore the picker, run for everyone
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<{ columns: { header: string; key: string }[]; client: any; count: number; rows: Record<string, any>[]; truncated?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.listClients().then(setClients).catch(() => {}); }, []);

  const shown = clients.filter((c) => { const s = q.trim().toLowerCase(); return !s || `${c.accountCode} ${c.legalName}`.toLowerCase().includes(s); });
  const toggleClient = (id: string) => setClientIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const run = async () => {
    if (!allCustomers && clientIds.length === 0) { setErr('Select at least one customer, or tick “All customers”.'); return; }
    setErr(''); setBusy(true); setData(null);
    try { setData(await api.billWorksheet(allCustomers ? 'all' : clientIds, from || undefined, to || undefined)); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const exportXlsx = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');
    const header = data.columns.map((c) => c.header);
    const aoa = [header, ...data.rows.map((r) => data.columns.map((c) => r[c.key] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bill working');
    const tag = (data.client.accountCode || data.client.legalName || 'customers').replace(/[^A-Za-z0-9]+/g, '-');
    XLSX.writeFile(wb, `Bill-working-${tag}-${to || 'all'}.xlsx`);
  };

  // Show the charge columns compactly in the on-screen preview (full set exports to Excel).
  const preview = ['CustomerCode', 'AWBNo', 'BookingDate', 'ProductCode', 'ZoneCode', 'ActualWeight', 'ChargeWeight', 'Freight', 'FuelSurcharge', 'EXTRA DELIVERY LOCATION', 'FREIGHT ON VALUE', 'APPOINTMENT DELIVERY', 'TotalSales'];

  return (
    <>
      <h1>🧾 Bill Working Sheet</h1>
      <p className="muted" style={{ marginTop: -14 }}>Per-AWB charge breakdown for a customer — same 59-column format you bill on. Export to Excel for the full sheet.</p>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <div className="row" style={{ gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px', minWidth: 300 }}>
            <label className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Customer(s) {!allCustomers && <span className="muted">— {clientIds.length ? `${clientIds.length} selected` : 'pick one or many'}</span>}</span>
              <label className="row" style={{ gap: 6, fontWeight: 600, fontSize: 13 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={allCustomers} onChange={(e) => setAllCustomers(e.target.checked)} /> All customers
              </label>
            </label>
            {!allCustomers && (
              <>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 filter customers…" style={{ marginBottom: 6 }} />
                <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                  {clientIds.length > 0 && <button className="secondary" style={{ padding: '1px 8px', fontSize: 11, marginBottom: 4 }} onClick={() => setClientIds([])}>clear ({clientIds.length})</button>}
                  {shown.map((c) => (
                    <label key={c.id} className="row" style={{ gap: 8, alignItems: 'center', fontSize: 13, padding: '2px 4px' }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={clientIds.includes(String(c.id))} onChange={() => toggleClient(String(c.id))} />
                      <span className="mono" style={{ fontSize: 12 }}>{c.accountCode}</span> — {c.legalName}
                    </label>
                  ))}
                  {shown.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 4 }}>No match.</div>}
                </div>
              </>
            )}
            {allCustomers && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Runs for every billable customer (cash / wallet excluded). Large — use a date range; it caps at 2,500 AWBs.</div>}
          </div>
          <div><label>From <span className="muted">(opt.)</span></label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To <span className="muted">(opt.)</span></label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={run} disabled={busy}>{busy ? 'Working…' : 'Generate'}</button>
            {data && <button className="secondary" onClick={exportXlsx}>⬇ Excel</button>}
          </div>
        </div>
      </div>

      {data && (
        <div className="card">
          <h2>{data.client.legalName} — {data.count} AWB(s)</h2>
          {data.truncated && <div className="card" style={{ borderLeft: '4px solid var(--warn, #d97706)', fontSize: 13, marginBottom: 10 }}>⚠ Capped at 2,500 AWBs — narrow the date range or pick fewer customers to see everything.</div>}
          {!data.rows.length ? <p className="muted">No shipments in range.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 13 }}>
                <thead><tr>{preview.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.rows.slice(0, 200).map((r, i) => (
                    <tr key={i}>{preview.map((h) => <td key={h}>{typeof r[h] === 'number' ? r[h].toLocaleString('en-IN') : r[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {data.rows.length > 200 && <p className="muted" style={{ marginTop: 8 }}>Showing first 200 — export to Excel for all {data.count}.</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
