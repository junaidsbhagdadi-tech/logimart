import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { BulkChangeDialog } from '../components/BulkChangeDialog';
import { StatusBadge } from '../components/StatusBadge';

type Row = {
  awb: string; invoiced?: boolean; bookDate: string; shipperName: string; customerCode: string; customerName: string;
  consigneeName: string; destination: string; product: string; vendor: string; forwardingAwb: string | null;
  actualWeight: number; chargeWeight: number; pieces: number; deliveryVendor: string; status: string;
  shipmentValue?: number | null; originPincode?: string | null; destPincode?: string | null; dimensions?: string;
  ewbNo?: string | null; ewbPending?: boolean; // ₹50k+ with no e-way bill number on file
  originName?: string; statusCode?: string;
};

// swdev #8-9 — one layout for customers and staff: no weights, dims, PINs or carrier waybill on screen.
const COLS: { key: keyof Row; label: string; num?: boolean }[] = [
  { key: 'awb', label: 'AWB No' },
  { key: 'bookDate', label: 'Book Date' },
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'consigneeName', label: 'Consignee Name' },
  { key: 'originName', label: 'Origin Name' },
  { key: 'destination', label: 'Destination Name' },
  { key: 'shipmentValue', label: 'Shipment Value', num: true },
  { key: 'ewbNo', label: 'E-way Bill' },
  { key: 'product', label: 'Product' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'forwardingAwb', label: 'Fwd AWB' },
  { key: 'pieces', label: 'Pieces', num: true },
  { key: 'statusCode', label: 'Status' },
];
// Staff Excel export keeps the operational detail the screen no longer shows.
const EXPORT_EXTRA: { key: keyof Row; label: string }[] = [
  { key: 'actualWeight', label: 'Actual Weight' },
  { key: 'chargeWeight', label: 'Charge Weight' },
  { key: 'originPincode', label: 'Origin PIN' },
  { key: 'destPincode', label: 'Dest PIN' },
  { key: 'dimensions', label: 'Dimensions (cm)' },
  { key: 'deliveryVendor', label: 'Delivery Vendor' },
];

const PAGE = 10;
const BTN = { padding: '3px 8px', fontSize: 12, whiteSpace: 'nowrap' as const };

export function AwbEntryList() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SYS_ADMIN';
  const isClient = user?.role === 'CLIENT_ADMIN';
  const [appt, setAppt] = useState<{ awb: string; date: string; remark: string } | null>(null);
  const isOps = ['HUB_MANAGER', 'SYS_ADMIN'].includes(user?.role || ''); // bulk void
  const canChangeDate = ['HUB_MANAGER', 'FINANCE_EXEC', 'SYS_ADMIN'].includes(user?.role || ''); // finance moves AWBs between billing months
  const nav = useNavigate();
  const [trackAwb, setTrackAwb] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [voidOpen, setVoidOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false); // #14 bulk change from the vendor-bill sheet
  const [voidText, setVoidText] = useState('');
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  // CS worklist: only ₹50k+ AWBs still missing their e-way bill (server-side, across all dates).
  const [ewbOnly, setEwbOnly] = useState(false);

  // When a booking-date range is set, pull the whole range (server lifts the 300 cap); otherwise the
  // latest 300. The AWB search box always matches across the whole database regardless of the range.
  const load = (search?: string, ewb = ewbOnly) => {
    const dated = !!(range.from || range.to);
    api.awbList(dated || ewb ? 10000 : 300, search, range.from || undefined, range.to || undefined, ewb)
      .then(setRows).catch((e) => setError(e.message));
    setSel(new Set());
  };
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
    )
      // Date-wise, NEWEST first.
      .sort((a, b) => new Date(b.bookDate || 0).getTime() - new Date(a.bookDate || 0).getTime());
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
    if (!confirm(`PERMANENTLY delete ${awbs.length} shipment${awbs.length > 1 ? 's' : ''} with their scans / PODs? This cannot be undone.\n\nInvoiced AWBs are skipped (raise a credit note). To keep a record instead, use 🚫 Void.`)) return;
    setError(''); setMsg('Deleting…');
    try {
      const r = await api.bulkDeleteShipments(awbs);
      const inv = r.invoiced ?? [];
      setMsg(`✓ Deleted ${r.deleted} shipment(s).${inv.length ? ` Skipped ${inv.length} invoiced AWB(s) — raise a credit note: ${inv.slice(0, 8).join(', ')}${inv.length > 8 ? '…' : ''}` : ''}`);
      load();
    }
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
    const t = new Date(); const p = (n: number) => String(n).padStart(2, '0');
    const date = window.prompt(`Change the booking / manifest date of ${awbs.length} AWB(s) to (DD-MM-YYYY):\n\nThe tracker's order date and the EDD move with it. Already-invoiced AWBs are skipped.`, `${p(t.getDate())}-${p(t.getMonth() + 1)}-${t.getFullYear()}`);
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

  // Super admin: permanently delete AWBs from a pasted/uploaded list (invoiced ones are skipped server-side).
  const deleteByList = async () => {
    const awbs = parseAwbList(voidText);
    if (!awbs.length) { setError('No AWBs found in the list.'); return; }
    if (!confirm(`PERMANENTLY delete ${awbs.length} AWB(s) from this list, with their scans / PODs? This cannot be undone.\n\nInvoiced AWBs are skipped (raise a credit note).`)) return;
    if (window.prompt(`Type DELETE to permanently remove ${awbs.length} AWB(s):`) !== 'DELETE') { setMsg('Cancelled — nothing was deleted.'); return; }
    setError(''); setMsg('Deleting…');
    try {
      const r = await api.bulkDeleteShipments(awbs);
      const inv = r.invoiced ?? [], nf = r.notFound ?? [];
      setMsg(`✓ Deleted ${r.deleted}/${awbs.length}.${inv.length ? ` Skipped ${inv.length} invoiced: ${inv.slice(0, 6).join(', ')}${inv.length > 6 ? '…' : ''}.` : ''}${nf.length ? ` ${nf.length} not found.` : ''}`);
      setVoidOpen(false); setVoidText(''); load();
    } catch (e: any) { setError(e.message); }
  };

  // Appointment / remark — customers go to CS through the portal endpoints; staff write straight to the AWB.
  const saveAppt = async () => {
    if (!appt) return;
    try {
      if (isClient) await api.portalAppointment(appt.awb, { date: appt.date || undefined, remark: appt.remark || undefined });
      else await api.setAppointment(appt.awb, { date: appt.date || undefined, note: appt.remark || undefined });
      setMsg(`✓ Appointment ${isClient ? 'sent to CS' : 'saved'} for ${appt.awb}.`); setAppt(null);
    } catch (e: any) { setError(e.message); }
  };
  const addRemark = async (awb: string) => {
    const r = window.prompt(isClient ? `Remark for our CS team about ${awb}:` : `Internal remark for ${awb} (shows on the timeline, not to the customer):`);
    if (r == null || !r.trim()) return;
    try {
      if (isClient) await api.portalRemark(awb, r.trim());
      else await api.recordScan({ awb, eventType: 'COMMENT', remark: r.trim() });
      setMsg(`✓ Remark saved for ${awb}.`);
    } catch (e: any) { setError(e.message); }
  };

  // Excel export of the CURRENTLY FILTERED rows (not just the visible page).
  const exportXls = async () => {
    const XLSX = await import('xlsx');
    const cols = isClient ? COLS : [...COLS, ...EXPORT_EXTRA];
    const head = cols.map((c) => c.label);
    const data = filtered.map((r) => cols.map((c) => (c.key === 'bookDate' ? fmtDate(r.bookDate) : c.key === 'ewbNo' ? (r.ewbNo || (r.ewbPending ? 'PENDING' : '')) : ((r as any)[c.key] ?? ''))));
    const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Shipments');
    XLSX.writeFile(wb, `shipments-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ margin: 0 }}>📝 Shipment List</h1>
        {/* #4 — quick AWB tracking right on My Shipments. */}
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const q = trackAwb.trim(); if (q) nav(`/tracker/${encodeURIComponent(q)}`); }}>
          <input value={trackAwb} onChange={(e) => setTrackAwb(e.target.value)} placeholder="Track an AWB" style={{ width: 200 }} />
          <button type="submit" disabled={!trackAwb.trim()}>🧭 Track</button>
        </form>
      </div>
      {appt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setAppt(null)}>
          <div className="card" style={{ maxWidth: 420, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>📅 Appointment delivery — {appt.awb}</h2>
            <div><label>Date &amp; time</label><input type="datetime-local" value={appt.date} onChange={(e) => setAppt({ ...appt, date: e.target.value })} /></div>
            <div style={{ marginTop: 8 }}><label>Remark <span className="muted">(optional)</span></label><input value={appt.remark} onChange={(e) => setAppt({ ...appt, remark: e.target.value })} placeholder="e.g. Call 98xxxxxxx before delivery" /></div>
            <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => setAppt(null)}>Cancel</button>
              <button onClick={saveAppt} disabled={!appt.date && !appt.remark}>{isClient ? 'Send to CS' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="secondary" onClick={() => load((filters.awb || '').trim() || undefined)} title="Refresh">⟳ Refresh</button>
            <span className="muted" style={{ fontSize: 13 }}>Book date</span>
            <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} title="From booking date" style={{ width: 150 }} />
            <span className="muted">→</span>
            <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} title="To booking date" style={{ width: 150 }} />
            <button className="secondary" onClick={() => load((filters.awb || '').trim() || undefined)} disabled={!range.from && !range.to} title="Pull all shipments booked in this date range">🔎 Apply dates</button>
            {(range.from || range.to) && <button className="secondary" onClick={() => { setRange({ from: '', to: '' }); setTimeout(() => load((filters.awb || '').trim() || undefined), 0); }} title="Clear the date range (back to latest 300)">✕ Dates</button>}
            <button className={ewbOnly ? '' : 'secondary'} onClick={() => { const v = !ewbOnly; setEwbOnly(v); setPage(0); load((filters.awb || '').trim() || undefined, v); }}
              title="Show only ₹50,000+ AWBs with no e-way bill number — open one and use Edit AWB to enter it">⚠ EWB pending{ewbOnly ? ` (${rows.length})` : ''}</button>
            {Object.values(filters).some(Boolean) && <button className="secondary" onClick={() => setFilters({})}>Clear filters</button>}
            <button className="secondary" onClick={exportXls} disabled={!filtered.length} title="Download the filtered list to Excel">⬇ Excel</button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {isOps && sel.size > 0 && <button className="secondary" title="Void the selected AWBs — excluded from billing, record kept (reversible)" onClick={voidSelected}>🚫 Void {sel.size}</button>}
            {canChangeDate && sel.size > 0 && <button className="secondary" title="Change the booking / manifest date of the selected AWBs" onClick={changeDateSelected}>📅 Change date {sel.size}</button>}
            {isSuper && sel.size > 0 && <button style={{ background: 'var(--bad, #c0392b)', color: '#fff' }} title="Permanently delete the selected shipments" onClick={deleteSelected}>🗑 Delete {sel.size}</button>}
            {isSuper && <button className="secondary" style={{ color: 'var(--danger, #c0392b)' }} title="Delete ALL shipments + invoices (keeps config)" onClick={clearAll}>🧹 Clear test shipments</button>}
            {canChangeDate && <button className="secondary" title="Upload the vendor-bill correction sheet — blank cells are left unchanged" onClick={() => setChangeOpen(true)}>✏️ Bulk change</button>}
            {isOps && <button className="secondary" title="Void many AWBs from a pasted / uploaded list" onClick={() => setVoidOpen(true)}>🚫 Void{isSuper ? ' / 🗑 Delete' : ''} by list</button>}
            <Link to="/bulk"><button className="secondary" title="Bulk import shipments from Excel">📥 Excel import</button></Link>
            <Link to="/create"><button>➕ New Shipment</button></Link>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {canChangeDate && <th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleSelAll} style={{ width: 'auto' }} title="Select all (filtered)" /></th>}
                {COLS.map((c) => <th key={c.key}>{c.label}</th>)}<th>Track</th><th>Appt</th><th>Remark</th>
              </tr>
              <tr>
                {canChangeDate && <th></th>}
                {COLS.map((c) => (
                  <th key={c.key} style={{ padding: 4 }}>
                    <input value={filters[c.key] || ''} onChange={(e) => setFilter(c.key, e.target.value)} placeholder={c.label}
                      style={{ fontSize: 12, padding: '5px 7px', fontWeight: 400 }} />
                  </th>
                ))}
                <th></th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.awb} style={sel.has(r.awb) ? { background: 'var(--bg-soft, #f2f4f7)' } : undefined}>
                  {canChangeDate && <td><input type="checkbox" checked={sel.has(r.awb)} onChange={() => toggleSel(r.awb)} style={{ width: 'auto' }} /></td>}
                  <td><Link to={isClient ? `/tracker/${encodeURIComponent(r.awb)}` : `/shipments/${r.awb}`}><strong>{r.awb}</strong></Link>{r.invoiced && <span title="Invoiced — locked for editing" style={{ marginLeft: 6 }}>🔒</span>}{r.ewbPending && <span className="badge EXCEPTION" title="Invoice value ₹50,000+ and no e-way bill number — enter it via Edit AWB" style={{ marginLeft: 6 }}>EWB</span>}</td>
                  <td>{fmtDate(r.bookDate)}</td>
                  <td>{r.customerCode}</td>
                  <td>{r.customerName}</td>
                  <td>{r.consigneeName || '—'}</td>
                  <td>{r.originName || '—'}</td>
                  <td>{r.destination || '—'}</td>
                  <td>{r.shipmentValue != null ? `₹${Number(r.shipmentValue).toLocaleString('en-IN')}` : '—'}</td>
                  <td>{r.ewbNo || (r.ewbPending ? <span className="badge EXCEPTION">Pending</span> : '—')}</td>
                  <td>{r.product || '—'}</td>
                  <td>{r.vendor || '—'}</td>
                  <td>{r.forwardingAwb || '—'}</td>
                  <td>{r.pieces}</td>
                  <td><StatusBadge code={r.statusCode} /></td>
                  <td><Link to={`/tracker/${encodeURIComponent(r.awb)}`}><button className="secondary" style={BTN}>🧭 Track</button></Link></td>
                  <td>{!['DLD', 'CAN', 'RTD'].includes(r.statusCode || '') && <button className="secondary" style={BTN} title="Appointment delivery date / time" onClick={() => setAppt({ awb: r.awb, date: '', remark: '' })}>📅 Appt</button>}</td>
                  <td><button className="secondary" style={BTN} title={isClient ? 'Leave a remark for our CS team' : 'Add an internal remark to the timeline'} onClick={() => addRemark(r.awb)}>✎ Remark</button></td>
                </tr>
              ))}
              {slice.length === 0 && <tr><td colSpan={COLS.length + 4} className="muted">No entries match.</td></tr>}
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

      {changeOpen && <BulkChangeDialog onClose={() => setChangeOpen(false)} onDone={() => load((filters.awb || '').trim() || undefined)} />}

      {voidOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setVoidOpen(false)}>
          <div className="card" style={{ width: 520, maxWidth: '92%' }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>🚫 Void{isSuper ? ' / delete' : ''} by AWB list</h2>
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
                {isSuper && <button className="secondary" style={{ color: 'var(--bad, #c0392b)', borderColor: 'var(--bad, #c0392b)' }} disabled={!parseAwbList(voidText).length} onClick={deleteByList} title="Super admin: permanently delete these AWBs (invoiced ones are skipped)">🗑 Delete {parseAwbList(voidText).length || ''}</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
