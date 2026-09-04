import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

type Row = {
  awb: string; invoiced?: boolean; bookDate: string; shipperName: string; customerCode: string; customerName: string;
  consigneeName: string; destination: string; product: string; vendor: string; forwardingAwb: string | null;
  actualWeight: number; chargeWeight: number; pieces: number; deliveryVendor: string; status: string;
  shipmentValue?: number | null; originPincode?: string | null; destPincode?: string | null; dimensions?: string;
};

const COLS: { key: keyof Row; label: string; num?: boolean }[] = [
  { key: 'awb', label: 'AWB No' },
  { key: 'bookDate', label: 'Book Date' },
  { key: 'shipperName', label: 'Shipper Name' },
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'consigneeName', label: 'Consignee Name' },
  { key: 'destination', label: 'Destination' },
  { key: 'originPincode', label: 'Origin PIN' },
  { key: 'destPincode', label: 'Dest PIN' },
  { key: 'shipmentValue', label: 'Shipment Value', num: true },
  { key: 'product', label: 'Product' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'forwardingAwb', label: 'Fwd AWB' },
  { key: 'actualWeight', label: 'Actual Weight', num: true },
  { key: 'chargeWeight', label: 'Charge Weight', num: true },
  { key: 'pieces', label: 'Pieces', num: true },
  { key: 'dimensions', label: 'Dimensions (cm)' },
  { key: 'deliveryVendor', label: 'Delivery Vendor' },
];

const PAGE = 10;

export function AwbEntryList() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SYS_ADMIN';
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());

  const load = () => { api.awbList(300).then(setRows).catch((e) => setError(e.message)); setSel(new Set()); };
  useEffect(load, []);

  const clearAll = async () => {
    if (!confirm('⚠ Delete ALL shipments and their invoices/scans from the LIVE database?\n\nThis KEEPS customers, vendors, rate cards, charges and masters — but every shipment + invoice is permanently removed and the AWB counter resets.\n\nContinue?')) return;
    const typed = window.prompt('This cannot be undone. Type CLEAR to confirm:');
    if (typed !== 'CLEAR') { setMsg('Cancelled — nothing was deleted.'); return; }
    setError(''); setMsg('Clearing…');
    try { const r = await api.clearShipments(); setMsg(`✓ Cleared ${r.totalDeleted} record(s): ${Object.entries(r.cleared).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}. Kept: ${r.kept.join(', ')}.`); load(); }
    catch (e: any) { setError(e.message); }
  };

  // #2 — Book Date shows date + time (24h).
  const fmtDate = (d: string) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');

  const filtered = useMemo(() => {
    return rows.filter((r) =>
      COLS.every((c) => {
        const f = (filters[c.key] || '').trim().toLowerCase();
        if (!f) return true;
        const v = c.key === 'bookDate' ? fmtDate(r.bookDate) : String(r[c.key] ?? '');
        return v.toLowerCase().includes(f);
      }),
    );
  }, [rows, filters]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * PAGE, cur * PAGE + PAGE);

  const setFilter = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0); };

  // Super-admin select + delete (across the whole filtered set, not just the visible page).
  const toggleSel = (awb: string) => setSel((s) => { const n = new Set(s); n.has(awb) ? n.delete(awb) : n.add(awb); return n; });
  const allSelected = filtered.length > 0 && filtered.every((r) => sel.has(r.awb));
  const toggleSelAll = () => setSel(allSelected ? new Set() : new Set(filtered.map((r) => r.awb)));
  const deleteSelected = async () => {
    if (sel.size === 0) return;
    const awbs = Array.from(sel);
    if (!confirm(`Permanently delete ${awbs.length} shipment${awbs.length > 1 ? 's' : ''} and all their scans / PODs / invoice lines? This cannot be undone.`)) return;
    setError(''); setMsg('Deleting…');
    try { const r = await api.bulkDeleteShipments(awbs); setMsg(`✓ Deleted ${r.deleted} shipment(s).`); load(); }
    catch (e: any) { setError(e.message); }
  };

  // Excel export of the CURRENTLY FILTERED rows (not just the visible page).
  const exportXls = async () => {
    const XLSX = await import('xlsx');
    const head = COLS.map((c) => c.label);
    const data = filtered.map((r) => COLS.map((c) => (c.key === 'bookDate' ? fmtDate(r.bookDate) : ((r as any)[c.key] ?? ''))));
    const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Shipments');
    XLSX.writeFile(wb, `shipments-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <>
      <h1>📝 Shipment List</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" onClick={load} title="Refresh">⟳ Refresh</button>
            {Object.values(filters).some(Boolean) && <button className="secondary" onClick={() => setFilters({})}>Clear filters</button>}
            <button className="secondary" onClick={exportXls} disabled={!filtered.length} title="Download the filtered list to Excel">⬇ Excel</button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {isSuper && sel.size > 0 && <button style={{ background: 'var(--bad, #c0392b)', color: '#fff' }} title="Delete the selected shipments" onClick={deleteSelected}>🗑 Delete {sel.size} selected</button>}
            {isSuper && <button className="secondary" style={{ color: 'var(--danger, #c0392b)' }} title="Delete ALL shipments + invoices (keeps config)" onClick={clearAll}>🧹 Clear test shipments</button>}
            <Link to="/bulk"><button className="secondary" title="Bulk import shipments from Excel">📥 Excel import</button></Link>
            <Link to="/create"><button>➕ New Shipment</button></Link>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {isSuper && <th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleSelAll} style={{ width: 'auto' }} title="Select all (filtered)" /></th>}
                {COLS.map((c) => <th key={c.key}>{c.label}</th>)}<th>Action</th>
              </tr>
              <tr>
                {isSuper && <th></th>}
                {COLS.map((c) => (
                  <th key={c.key} style={{ padding: 4 }}>
                    <input value={filters[c.key] || ''} onChange={(e) => setFilter(c.key, e.target.value)} placeholder={c.label}
                      style={{ fontSize: 12, padding: '5px 7px', fontWeight: 400 }} />
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.awb} style={sel.has(r.awb) ? { background: 'var(--bg-soft, #f2f4f7)' } : undefined}>
                  {isSuper && <td><input type="checkbox" checked={sel.has(r.awb)} onChange={() => toggleSel(r.awb)} style={{ width: 'auto' }} /></td>}
                  <td><Link to={`/shipments/${r.awb}`}><strong>{r.awb}</strong></Link>{r.invoiced && <span title="Invoiced — locked for editing" style={{ marginLeft: 6 }}>🔒</span>}</td>
                  <td>{fmtDate(r.bookDate)}</td>
                  <td>{r.shipperName}</td>
                  <td>{r.customerCode}</td>
                  <td>{r.customerName}</td>
                  <td>{r.consigneeName || '—'}</td>
                  <td>{r.destination || '—'}</td>
                  <td>{r.originPincode || '—'}</td>
                  <td>{r.destPincode || '—'}</td>
                  <td>{r.shipmentValue != null ? `₹${Number(r.shipmentValue).toLocaleString('en-IN')}` : '—'}</td>
                  <td>{r.product || '—'}</td>
                  <td>{r.vendor || '—'}</td>
                  <td>{r.forwardingAwb || '—'}</td>
                  <td>{r.actualWeight.toFixed(3)}</td>
                  <td>{r.chargeWeight.toFixed(3)}</td>
                  <td>{r.pieces}</td>
                  <td>{r.deliveryVendor}</td>
                  <td><Link to={`/shipments/${r.awb}`} className="muted" style={{ fontSize: 12 }}>open →</Link></td>
                </tr>
              ))}
              {slice.length === 0 && <tr><td colSpan={COLS.length + (isSuper ? 2 : 1)} className="muted">No entries match.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <div className="muted">Showing {filtered.length === 0 ? 0 : cur * PAGE + 1} to {Math.min(filtered.length, cur * PAGE + PAGE)} of {filtered.length} entries</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="secondary" disabled={cur === 0} onClick={() => setPage(0)}>First</button>
            <button className="secondary" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</button>
            <span className="badge CREATED" style={{ alignSelf: 'center' }}>{cur + 1} / {pages}</span>
            <button className="secondary" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
            <button className="secondary" disabled={cur >= pages - 1} onClick={() => setPage(pages - 1)}>Last</button>
          </div>
        </div>
      </div>
    </>
  );
}
