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
  const isOps = ['HUB_MANAGER', 'SYS_ADMIN'].includes(user?.role || ''); // bulk void / date-change
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidText, setVoidText] = useState('');

  const load = (search?: string) => { api.awbList(300, search).then(setRows).catch((e) => setError(e.message)); setSel(new Set()); };
  // The AWB filter searches the WHOLE database (server-side), so any AWB is findable — not just the
  // latest 300 loaded. Debounced; other column filters still narrow the returned set client-side.
  useEffect(() => {
    const term = (filters.awb || '').trim();
    if (!term) { load(); return; }
    const t = setTimeout(() => load(term), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.awb]);

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
  // Bulk VOID — reversible-in-spirit (excluded from billing, record kept); safer than hard-delete.
  const voidSelected = async () => {
    if (sel.size === 0) return;
    const awbs = Array.from(sel);
    const reason = window.prompt(`Void ${awbs.length} AWB(s)? They'll be marked cancelled and excluded from billing (the record is kept). Reason:`, 'Bulk void (wrong entry)');
    if (reason === null) return;
    setError(''); setMsg('Voiding…');
    try {
      const r = await api.bulkCancelAwbs(awbs, reason || undefined);
      const failed = r.results.filter((x) => !x.ok);
      setMsg(`✓ Voided ${r.voided}/${r.total}.${failed.length ? ' Skipped: ' + failed.slice(0, 6).map((f) => `${f.awb} (${f.error})`).join('; ') : ''}`); load();
    } catch (e: any) { setError(e.message); }
  };
  // Bulk booking-date change — corrects a wrong booking date (blocks invoiced AWBs server-side).
  const changeDateSelected = async () => {
    if (sel.size === 0) return;
    const awbs = Array.from(sel);
    const date = window.prompt(`Change the booking date of ${awbs.length} AWB(s) to (YYYY-MM-DD):`, new Date().toISOString().slice(0, 10));
    if (!date) return;
    setError(''); setMsg('Updating…');
    try {
      const r = await api.bulkDateAwbs(awbs, date);
      const failed = r.results.filter((x) => !x.ok);
      setMsg(`✓ Changed ${r.changed}/${r.total} to ${date}.${failed.length ? ' Skipped: ' + failed.slice(0, 6).map((f) => `${f.awb} (${f.error})`).join('; ') : ''}`); load();
    } catch (e: any) { setError(e.message); }
  };

  // Bulk void from a pasted/uploaded list of AWBs (file has only AWB numbers). Any delimiter.
  const parseAwbList = (text: string) => [...new Set(text.split(/[^A-Za-z0-9]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const onVoidFile = async (f?: File) => {
    if (!f) return;
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
        setVoidText(rows.flat().map((x) => String(x ?? '')).filter(Boolean).join('\n'));
      } else { setVoidText(await f.text()); }
    } catch (e: any) { setError('Could not read file: ' + e.message); }
  };
  const voidByList = async () => {
    const awbs = parseAwbList(voidText);
    if (!awbs.length) { setError('No AWBs found in the list.'); return; }
    if (!confirm(`Void ${awbs.length} AWB(s) from this list? They'll be marked cancelled and excluded from billing (records kept).`)) return;
    setError(''); setMsg('Voiding…');
    try {
      const r = await api.bulkCancelAwbs(awbs, 'Bulk void by AWB list');
      const failed = r.results.filter((x) => !x.ok);
      setMsg(`✓ Voided ${r.voided}/${r.total}.${failed.length ? ' Skipped: ' + failed.slice(0, 8).map((f) => `${f.awb} (${f.error})`).join('; ') : ''}`);
      setVoidOpen(false); setVoidText(''); load();
    } catch (e: any) { setError(e.message); }
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
            <button className="secondary" onClick={() => load((filters.awb || '').trim() || undefined)} title="Refresh">⟳ Refresh</button>
            {Object.values(filters).some(Boolean) && <button className="secondary" onClick={() => setFilters({})}>Clear filters</button>}
            <button className="secondary" onClick={exportXls} disabled={!filtered.length} title="Download the filtered list to Excel">⬇ Excel</button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {isOps && sel.size > 0 && <button className="secondary" title="Void the selected AWBs — excluded from billing, record kept (reversible)" onClick={voidSelected}>🚫 Void {sel.size}</button>}
            {isOps && sel.size > 0 && <button className="secondary" title="Change the booking date of the selected AWBs" onClick={changeDateSelected}>📅 Change date {sel.size}</button>}
            {isSuper && sel.size > 0 && <button style={{ background: 'var(--bad, #c0392b)', color: '#fff' }} title="Permanently delete the selected shipments" onClick={deleteSelected}>🗑 Delete {sel.size}</button>}
            {isSuper && <button className="secondary" style={{ color: 'var(--danger, #c0392b)' }} title="Delete ALL shipments + invoices (keeps config)" onClick={clearAll}>🧹 Clear test shipments</button>}
            {isOps && <button className="secondary" title="Void many AWBs from a pasted / uploaded list" onClick={() => setVoidOpen(true)}>🚫 Void by list</button>}
            <Link to="/bulk"><button className="secondary" title="Bulk import shipments from Excel">📥 Excel import</button></Link>
            <Link to="/create"><button>➕ New Shipment</button></Link>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {isOps && <th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleSelAll} style={{ width: 'auto' }} title="Select all (filtered)" /></th>}
                {COLS.map((c) => <th key={c.key}>{c.label}</th>)}<th>Action</th>
              </tr>
              <tr>
                {isOps && <th></th>}
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
                  {isOps && <td><input type="checkbox" checked={sel.has(r.awb)} onChange={() => toggleSel(r.awb)} style={{ width: 'auto' }} /></td>}
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
              {slice.length === 0 && <tr><td colSpan={COLS.length + (isOps ? 2 : 1)} className="muted">No entries match.</td></tr>}
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

      {voidOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setVoidOpen(false)}>
          <div className="card" style={{ width: 520, maxWidth: '92%' }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>🚫 Void by AWB list</h2>
              <button className="secondary" style={{ padding: '4px 12px' }} onClick={() => setVoidOpen(false)}>✕</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>Paste AWB numbers (one per line / comma / space) or upload a file with just the AWBs. They'll be voided — excluded from billing, records kept.</p>
            <textarea value={voidText} onChange={(e) => setVoidText(e.target.value)} rows={8} placeholder={'L1000000101\nL1000000102\n…'} style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} />
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
              <label className="secondary" style={{ padding: '8px 12px', borderRadius: 10, cursor: 'pointer', border: '1px solid var(--border)', fontSize: 13 }}>
                ⬆ Upload CSV/Excel<input type="file" accept=".csv,.txt,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => onVoidFile(e.target.files?.[0])} />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{parseAwbList(voidText).length} AWB(s)</span>
                <button style={{ background: 'var(--bad, #c0392b)', color: '#fff' }} disabled={!parseAwbList(voidText).length} onClick={voidByList}>Void {parseAwbList(voidText).length || ''}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
