import { useEffect, useState } from 'react';
import { api, Client } from '../api';

/** Per-AWB bill working sheet (all charge heads) — matches the "Customer bill working"
 *  format exactly, viewable + exportable to Excel. */
export function BillWorksheet() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<{ columns: { header: string; key: string }[]; client: any; count: number; rows: Record<string, any>[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.listClients().then(setClients).catch(() => {}); }, []);

  const run = async () => {
    if (!clientId) { setErr('Select a customer.'); return; }
    setErr(''); setBusy(true); setData(null);
    try { setData(await api.billWorksheet(clientId, from || undefined, to || undefined)); }
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
    XLSX.writeFile(wb, `Bill-working-${data.client.accountCode}-${to || 'all'}.xlsx`);
  };

  // Show the charge columns compactly in the on-screen preview (full set exports to Excel).
  const preview = ['AWBNo', 'BookingDate', 'ProductCode', 'ZoneCode', 'ChargeWeight', 'Freight', 'FuelSurcharge', 'EXTRA DELIVERY LOCATION', 'FREIGHT ON VALUE', 'APPOINTMENT DELIVERY', 'TotalSales'];

  return (
    <>
      <h1>🧾 Bill Working Sheet</h1>
      <p className="muted" style={{ marginTop: -14 }}>Per-AWB charge breakdown for a customer — same 59-column format you bill on. Export to Excel for the full sheet.</p>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <div className="grid cols-4" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label>Customer *</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select customer</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
            </select>
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
