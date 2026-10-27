import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { COMPANY } from '../company';
import { fmtDateTime } from '../format';

/**
 * Vendor handover manifest — after booking, list the day's shipments for a carrier, tick what's being
 * handed over, and print a manifest both sides sign at handover (acknowledgement of receipt).
 */
type Row = { awb: string; bookDate: string; customerCode: string; customerName: string; consigneeName: string; destination: string; destPincode?: string | null; vendor: string; forwardingAwb: string | null; pieces: number; actualWeight: number; chargeWeight: number; status?: string; statusCode?: string };

const todayIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function Handover() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [date, setDate] = useState(todayIst());
  const [vendor, setVendor] = useState(params.get('vendor') || '');
  const [cust, setCust] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [vendors, setVendors] = useState<{ code: string; name: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Latest booking date that has shipments — offered when the picked day is empty (bulk uploads carry
  // their own booking date, so "today" is often empty even right after an upload).
  const [lastDate, setLastDate] = useState('');
  useEffect(() => {
    api.awbList(1).then((r: any[]) => {
      const c = r[0]?.createdAt || r[0]?.bookDate;
      if (c) setLastDate(new Date(new Date(c).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10));
    }).catch(() => {});
  }, []);

  useEffect(() => { api.listVendors().then((v: any[]) => setVendors(v.map((x) => ({ code: x.vendorCode, name: x.name })))).catch(() => {}); }, []);
  const load = () => {
    setBusy(true); setErr('');
    api.awbList(10000, undefined, date, date)
      .then((r: any[]) => { setRows(r.filter((x) => x.statusCode !== 'CAN')); setSel(new Set()); })
      .catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };
  useEffect(load, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => rows.filter((r) =>
    (!vendor || String(r.vendor || 'SELF').toUpperCase() === vendor.toUpperCase())
    && (!cust.trim() || `${r.customerCode} ${r.customerName}`.toLowerCase().includes(cust.trim().toLowerCase()))), [rows, vendor, cust]);
  const allSel = shown.length > 0 && shown.every((r) => sel.has(r.awb));
  const picked = shown.filter((r) => sel.has(r.awb));
  const vendorName = (c: string) => vendors.find((v) => v.code.toUpperCase() === String(c || '').toUpperCase())?.name || c || 'SELF';
  const print = () => nav('/handover/print', { state: { rows: picked, vendor: vendor || (picked[0]?.vendor ?? ''), vendorName: vendorName(vendor || picked[0]?.vendor), date } });

  return (
    <>
      <h1>📋 Handover manifest</h1>
      <p className="muted" style={{ marginTop: -12 }}>Shipments booked on the day, per carrier — tick what you're handing over and print the manifest for the vendor to sign.</p>
      {err && <div className="error">{err}</div>}
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>Booking date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label>Vendor</label>
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">All vendors</option><option value="SELF">SELF</option>
              {vendors.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
            </select>
          </div>
          <div><label>Customer</label><input value={cust} onChange={(e) => setCust(e.target.value)} placeholder="code or name" /></div>
          <button className="secondary" onClick={load} disabled={busy}>{busy ? 'Loading…' : '⟳ Refresh'}</button>
          <button onClick={print} disabled={!picked.length}>🖨 Print manifest ({picked.length})</button>
        </div>
        {!vendor && picked.length > 0 && new Set(picked.map((r) => r.vendor || 'SELF')).size > 1 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>⚠ The selection spans several vendors — pick one vendor for a clean handover sheet.</p>}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: 12.5, minWidth: 900 }}>
          <thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(shown.map((r) => r.awb)))} style={{ width: 'auto' }} /></th>
            <th>AWB</th><th>Forwarding no</th><th>Vendor</th><th>Customer</th><th>Consignee</th><th>Destination</th><th style={{ textAlign: 'right' }}>Pcs</th><th style={{ textAlign: 'right' }}>Weight</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.awb}>
                <td><input type="checkbox" checked={sel.has(r.awb)} onChange={() => setSel((s) => { const n = new Set(s); n.has(r.awb) ? n.delete(r.awb) : n.add(r.awb); return n; })} style={{ width: 'auto' }} /></td>
                <td className="mono"><strong>{r.awb}</strong></td><td className="mono">{r.forwardingAwb || '—'}</td><td>{r.vendor || 'SELF'}</td>
                <td>{r.customerName}<div className="muted" style={{ fontSize: 11 }}>{r.customerCode}</div></td>
                <td>{r.consigneeName || '—'}</td><td>{r.destination}{r.destPincode ? ` · ${r.destPincode}` : ''}</td>
                <td style={{ textAlign: 'right' }}>{r.pieces}</td><td style={{ textAlign: 'right' }}>{Number(r.actualWeight || 0).toFixed(2)} kg</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 16 }}>No shipments booked on this date{vendor ? ` for ${vendor}` : ''}.
              {!busy && lastDate && lastDate !== date && <> Latest bookings are on <a href="#" onClick={(e) => { e.preventDefault(); setDate(lastDate); }}>{lastDate.split('-').reverse().join('-')}</a>.</>}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Print sheet (outside the app layout) — opened from Handover with the selected rows in router state. */
export function HandoverPrint() {
  const { state: navState } = useLocation() as { state?: { rows: Row[]; vendor: string; vendorName: string; date: string } };
  const nav = useNavigate();
  // The rider app opens this page directly: /handover/print?date=YYYY-MM-DD&awbs=A,B&vendor=X — no router state.
  const [params] = useSearchParams();
  const [loaded, setLoaded] = useState<typeof navState>(undefined);
  useEffect(() => {
    if (navState?.rows?.length) return;
    const awbs = new Set((params.get('awbs') || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean));
    const date = params.get('date') || todayIst();
    if (!awbs.size) return;
    Promise.all([api.awbList(20000, undefined, date, date), api.listVendors().catch(() => [] as any[])]).then(([r, vs]: [any[], any[]]) => {
      const rows = r.filter((x) => awbs.has(String(x.awb).toUpperCase()));
      const vendor = params.get('vendor') || rows[0]?.vendor || '';
      const vendorName = vs.find((v) => String(v.vendorCode).toUpperCase() === String(vendor).toUpperCase())?.name || vendor || 'SELF';
      setLoaded({ rows, vendor, vendorName, date });
    }).catch(() => {});
  }, [navState, params]);
  const state = navState?.rows?.length ? navState : loaded;
  useEffect(() => { if (state?.rows?.length) setTimeout(() => window.print(), 400); }, [state]);
  if (!state && params.get('awbs')) return <div style={{ padding: 24 }}>Loading manifest…</div>;
  if (!state?.rows?.length) return <div style={{ padding: 24 }}>Nothing to print. <button onClick={() => nav('/handover')}>Back</button></div>;
  const { rows, vendor, vendorName, date } = state;
  const pcs = rows.reduce((s, r) => s + Number(r.pieces || 0), 0);
  const kg = rows.reduce((s, r) => s + Number(r.actualWeight || 0), 0);
  const now = new Date();
  const no = `HM-${date.replace(/-/g, '')}-${String(vendor || 'SELF').toUpperCase()}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const cell: CSSProperties = { border: '1px solid #999', padding: '4px 6px', fontSize: 11 };
  return (
    <div style={{ padding: 24, color: '#000', background: '#fff', fontFamily: 'Arial, sans-serif' }}>
      <style>{'@media print { .no-print { display: none !important; } @page { size: A4; margin: 12mm; } }'}</style>
      <div className="no-print" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button onClick={() => window.print()}>🖨 Print</button><button onClick={() => nav(-1)}>← Back</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: 8 }}>
        <div><div style={{ fontWeight: 800, fontSize: 16 }}>{COMPANY.legalName}</div><div style={{ fontSize: 11 }}>{COMPANY.addressLines.join(' ')}</div></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 800, fontSize: 15 }}>SHIPMENT HANDOVER MANIFEST</div><div style={{ fontSize: 11 }}>No. {no}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 24, fontSize: 12, margin: '10px 0' }}>
        <div><b>Vendor:</b> {vendorName}{vendor ? ` (${vendor})` : ''}</div>
        <div><b>Booking date:</b> {date.split('-').reverse().join('-')}</div>
        <div><b>Printed:</b> {fmtDateTime(now)}</div>
        <div><b>Shipments:</b> {rows.length} · <b>Pieces:</b> {pcs} · <b>Weight:</b> {kg.toFixed(2)} kg</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['#', 'AWB', 'Forwarding no', 'Customer code', 'Consignee', 'Destination', 'Pcs', 'Weight (kg)'].map((h) => <th key={h} style={{ ...cell, background: '#eee', textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.awb}>
              <td style={cell}>{i + 1}</td><td style={{ ...cell, fontFamily: 'monospace' }}>{r.awb}</td><td style={{ ...cell, fontFamily: 'monospace' }}>{r.forwardingAwb || ''}</td>
              {/* The carrier signs this sheet — our customer's CODE only, never their name. */}
              <td style={cell}>{r.customerCode}</td><td style={cell}>{r.consigneeName}</td>
              <td style={cell}>{r.destination}{r.destPincode ? ` ${r.destPincode}` : ''}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{r.pieces}</td><td style={{ ...cell, textAlign: 'right' }}>{Number(r.actualWeight || 0).toFixed(2)}</td>
            </tr>
          ))}
          <tr><td style={{ ...cell, fontWeight: 700 }} colSpan={6}>TOTAL — {rows.length} shipment(s)</td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{pcs}</td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{kg.toFixed(2)}</td></tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 40, marginTop: 40, fontSize: 12 }}>
        {[`Handed over by — ${COMPANY.legalName}`, `Received by — ${vendorName}`].map((t) => (
          <div key={t} style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 28 }}>{t}</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: 4 }}>Name &amp; signature</div>
            <div style={{ marginTop: 18, borderTop: '1px solid #000', paddingTop: 4 }}>Date &amp; time</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 10, marginTop: 16 }}>Received the above {rows.length} shipment(s) / {pcs} piece(s) in good condition unless noted.</p>
    </div>
  );
}
