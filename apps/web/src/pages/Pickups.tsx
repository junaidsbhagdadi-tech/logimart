import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { useRights } from '../rights';
import { fmtDate, fmtDateTime } from '../format';

const blank = {
  pickupAddress: '', city: '', pincode: '', contactName: '', contactPhone: '', estPieces: '1', weight: '',
  product: '', vendor: '', refNo: '', invoiceNo: '', invoiceValue: '', ewbNo: '', notes: '', isWarehouse: false,
};

/** `mode='book'` = the internal Pickup Booking screen: the SAME form customers use (#7), plus a customer picker. */
export function Pickups({ mode }: { mode?: 'book' } = {}) {
  const { user } = useAuth();
  const isClient = user?.role === 'CLIENT_ADMIN';
  // Staff who act on pickups: ops + CS (anyone with EDIT on Pickups) — CS couldn't see the action buttons before.
  const pickRights = useRights('/pickups');
  const isOps = !isClient && (['HUB_MANAGER', 'SYS_ADMIN', 'ADMIN', 'WAREHOUSE_HANDLER'].includes(user?.role || '') || pickRights.edit);
  const [rows, setRows] = useState<any[]>([]);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday'>('all'); // #I — see yesterday's pickups
  const [riders, setRiders] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [assigning, setAssigning] = useState<any | null>(null); // the pickup being assigned
  const [selRider, setSelRider] = useState('');
  const [detail, setDetail] = useState<any | null>(null); // the pickup request shown in the CS detail popup
  const [handingOff, setHandingOff] = useState(''); // id currently being handed off to the vendor
  const [msg, setMsg] = useState('');
  // Internal booking: which customer the pickup is for (customers pick nothing — it's their own account).
  const [clients, setClients] = useState<{ id: string; accountCode: string; legalName: string }[]>([]);
  const [custQ, setCustQ] = useState('');
  const [custId, setCustId] = useState('');
  useEffect(() => { if (isOps) api.listClients().then((cs: any[]) => setClients(cs.filter((c) => c.isActive !== false).map((c) => ({ id: String(c.id), accountCode: c.accountCode, legalName: c.legalName })))).catch(() => {}); }, [isOps]);
  const custShown = clients.filter((c) => { const q = custQ.trim().toLowerCase(); return !q || `${c.accountCode} ${c.legalName}`.toLowerCase().includes(q); }).slice(0, 300);
  // BlueDart pickups (registered collections, incl. outstation to-pay) — ops view.
  const [bdPickups, setBdPickups] = useState<any[]>([]);
  const [bdSyncing, setBdSyncing] = useState('');
  const loadBd = () => api.bdPickups().then(setBdPickups).catch(() => {});
  useEffect(() => { if (isOps) loadBd(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isOps]);
  const syncBd = async (awb: string) => { setBdSyncing(awb); setError(''); try { await api.bdSync(awb); await loadBd(); } catch (e: any) { setError(e.message); } finally { setBdSyncing(''); } };

  // Bulk upload (paste rows from Excel — tab-delimited — or a CSV). Ops rows carry an accountCode
  // per row; a client login is pinned to its own account so that column is ignored.
  const BULK_COLS = (isClient
    ? 'pickupAddress,city,pincode,contactName,contactPhone,estPieces,cargoMode,invoiceNo,invoiceDate,invoiceValue,ewbNo,notes'
    : 'accountCode,pickupAddress,city,pincode,contactName,contactPhone,estPieces,cargoMode,invoiceNo,invoiceDate,invoiceValue,ewbNo,notes');
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkVendor, setBulkVendor] = useState(''); // #3 — one vendor for the whole upload (blank = none / assign at booking)
  const [vendors, setVendors] = useState<{ vendorCode: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string }[]>([]);
  // Vendor options for the pickup form: a client sees only its assigned courier partners (from its
  // account); CS/ops sees all active vendors.
  const [myVendors, setMyVendors] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    if (isOps) api.listVendors().then((v: any[]) => setVendors(v.filter((x) => x.isActive !== false).map((x) => ({ vendorCode: x.vendorCode, name: x.name })))).catch(() => {});
    else if (isClient) api.portalAccounts().then((rows: any[]) => { const a = rows[0]; setMyVendors(Array.isArray(a?.allowedVendors) ? a.allowedVendors : []); }).catch(() => {});
    api.listMaster('PRODUCT').then((r) => setProducts(r.map((x) => ({ code: x.code, name: x.name })))).catch(() => {});
  }, [isOps, isClient]);
  const formVendors = isClient ? myVendors : vendors.map((v) => ({ code: v.vendorCode, name: v.name }));
  const [bulkResult, setBulkResult] = useState<{ total: number; created: number; results: { row: string; ok: boolean; error?: string }[] } | null>(null);
  const downloadTemplate = () => {
    const example = isClient
      ? '"12 MG Road, Indiranagar",Bengaluru,560038,Ravi,9900112233,3,ROAD,INV-101,2026-09-01,48500,,handle with care'
      : 'ACME001,"12 MG Road, Indiranagar",Bengaluru,560038,Ravi,9900112233,3,ROAD,INV-101,2026-09-01,48500,,handle with care';
    const csv = BULK_COLS + '\n' + example + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logimart-pickups-template.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const parseBulk = (text: string) => {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [] as any[];
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const known = BULK_COLS.split(',');
    const first = lines[0].split(delim).map((h) => h.trim());
    const useHeader = first.some((h) => known.includes(h));
    const cols = useHeader ? first : known;
    const body = useHeader ? lines.slice(1) : lines;
    return body.map((l) => { const p = l.split(delim); const o: any = {}; cols.forEach((c, i) => { o[c] = (p[i] ?? '').trim(); }); return o; });
  };
  const doBulk = async () => {
    setError(''); setBulkResult(null);
    const rows = parseBulk(bulkText);
    if (!rows.length) { setError('Nothing to import — paste rows first.'); return; }
    setBulkBusy(true);
    try { const r = await api.bulkPickups(rows, bulkVendor || undefined); setBulkResult(r); load(); }
    catch (e: any) { setError(e.message); }
    finally { setBulkBusy(false); }
  };

  const load = () => {
    api.listPickups().then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  // Ops staff need the rider list to assign pickups by name (not a raw user id).
  useEffect(() => { if (isOps) api.listRiders().then((r) => setRiders(r.filter((x: any) => x.isActive !== false))).catch(() => {}); }, [isOps]);
  const riderLabel = (id: any) => { const r = riders.find((x) => String(x.id) === String(id)); return r ? `${r.riderCode} · ${r.fullName}` : (id != null ? `#${id}` : '—'); };
  // Date filter — pickups are shown newest-first regardless; this lets ops see just today's or
  // yesterday's generated pickups (feedback #I).
  const dayKey = (d: any) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
  const todayKey = dayKey(new Date());
  const yesterdayKey = dayKey(new Date(Date.now() - 864e5));
  const visibleRows = rows.filter((p) => dateFilter === 'all' || (dateFilter === 'today' ? dayKey(p.createdAt) === todayKey : dayKey(p.createdAt) === yesterdayKey));

  const set = (k: keyof typeof blank, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  // Auto-fetch the city from the pincode (6 digits), like the booking form.
  const onPincode = (v: string) => {
    set('pincode', v);
    if (/^\d{6}$/.test(v)) api.lookupPincode(v).then((info: any) => { if (info?.city) set('city', info.city); }).catch(() => {});
  };

  const create = async () => {
    setError(''); setMsg('');
    if (!isClient && !custId) { setError('Pick the customer this pickup is for.'); return; }
    try {
      await api.createPickup({
        ...(!isClient ? { clientId: +custId } : {}),
        pickupAddress: form.pickupAddress,
        city: form.city || undefined,
        pincode: form.pincode || undefined,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        estPieces: form.estPieces ? +form.estPieces : 1,
        weight: form.weight ? +form.weight : undefined,
        product: form.product || undefined,
        vendor: form.vendor || undefined,
        isWarehouse: form.isWarehouse || undefined,
        refNo: form.refNo || undefined,
        invoiceNo: form.invoiceNo || undefined,
        invoiceValue: form.invoiceValue ? +form.invoiceValue : undefined,
        ewbNo: form.ewbNo || undefined,
        notes: form.notes || undefined,
      });
      const cust = clients.find((c) => c.id === custId);
      setMsg(`✓ Pickup requested${cust ? ` for ${cust.accountCode} — ${cust.legalName}` : ''}. Hand it to a vendor from the Pickups list.`);
      setForm({ ...blank });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const openAssign = (p: any) => { setAssigning(p); setSelRider(p.assignedRiderId != null ? String(p.assignedRiderId) : ''); setError(''); };
  const doAssign = async () => {
    if (!assigning || !selRider) return;
    try { await api.assignPickup(assigning.id, +selRider); setAssigning(null); load(); } catch (e: any) { setError(e.message); }
  };
  const openDetail = async (p: any) => { setError(''); setDetail({ ...p, loading: true }); try { setDetail(await api.pickupDetail(String(p.id))); } catch (e: any) { setError(e.message); setDetail(null); } };

  // Hand-off modal (CS picks the vendor — can override the customer's choice).
  const [handoffFor, setHandoffFor] = useState<any | null>(null);
  const [hVendor, setHVendor] = useState('');
  const [hToken, setHToken] = useState('');
  const [hToPay, setHToPay] = useState(false);
  // BlueDart books only WITH the destination — the hand-off books the shipment + generates the AWB.
  const [hd, setHd] = useState({ destPincode: '', consigneeName: '', consigneePhone: '', consigneeAddress: '', weight: '', pieces: '', value: '' });
  const isBdVendor = (code: string) => /^(BLUE|BDR)/i.test(code) || /^(BDR|BLUE|BD )/i.test(vendors.find((v) => v.vendorCode === code)?.name || '');
  // XpressBees also books with the destination (manifest → XpressBees AWB, then their pickup request).
  const isXbVendor = (code: string) => /^XPB$|XPRESS\s*BEES/i.test(code) || /XPRESS\s*BEES/i.test(vendors.find((v) => v.vendorCode === code)?.name || '');
  const needsDest = (code: string) => isBdVendor(code) || isXbVendor(code);
  const openHandoff = (p: any) => {
    setHandoffFor(p); setHVendor(p.vendor || ''); setHToken(''); setHToPay(false); setError(''); setMsg('');
    setHd({ destPincode: '', consigneeName: '', consigneePhone: '', consigneeAddress: '', weight: p.weight != null ? String(p.weight) : '', pieces: String(p.estPieces || 1), value: p.invoiceValue != null ? String(p.invoiceValue) : '' });
  };
  const doHandoff = async () => {
    if (!handoffFor) return;
    setError(''); setMsg(''); setHandingOff(String(handoffFor.id));
    try {
      const bd = needsDest(hVendor);
      const r: any = await api.pickupHandoff(String(handoffFor.id), {
        vendor: hVendor || undefined, toPay: hToPay, token: hToken || undefined,
        ...(bd ? { destPincode: hd.destPincode || undefined, consigneeName: hd.consigneeName || undefined, consigneePhone: hd.consigneePhone || undefined, consigneeAddress: hd.consigneeAddress || undefined,
          weight: hd.weight ? +hd.weight : undefined, pieces: hd.pieces ? +hd.pieces : undefined, value: hd.value ? +hd.value : undefined } : {}),
      });
      setMsg(isXbVendor(hVendor)
        ? `✓ Booked ${r.awb} — XpressBees AWB ${r.xbAwb ?? '—'}, pickup request ${r.token ?? '(pending)'}.`
        : bd
        ? (r.bdWaybill ? `✓ Booked ${r.awb} — BlueDart AWB ${r.bdWaybill}${r.token ? `, pickup token ${r.token}` : ''}${r.outstation ? ' (to-pay, billed to the account)' : ''}.` : `⚠ Booked ${r.awb} but no BlueDart AWB yet. ${r.reason ?? ''}`)
        : `✓ Handed to ${hVendor || 'carrier'} — pickup token ${r.token ?? '(pending)'}. The customer can see it on their panel.`);
      setHandoffFor(null); setDetail(null); load();
    } catch (e: any) { setError(e.message); } finally { setHandingOff(''); }
  };

  // Mark-picked modal (capture AWB / weight / pcs / value).
  const [pickedFor, setPickedFor] = useState<any | null>(null);
  const [pk, setPk] = useState({ awb: '', weight: '', pieces: '', value: '', destPincode: '', consigneeName: '', consigneePhone: '' });
  const openPicked = (p: any) => { setPickedFor(p); setPk({ awb: p.pickedAwb || '', weight: p.pickedWeight || p.weight || '', pieces: String(p.estPieces || ''), value: p.pickedValue || p.invoiceValue || '', destPincode: '', consigneeName: '', consigneePhone: '' }); setError(''); };
  const doPicked = async () => {
    if (!pickedFor) return;
    try {
      const r: any = await api.completePickup(String(pickedFor.id), { awb: pk.awb || undefined, weight: pk.weight ? +pk.weight : undefined, pieces: pk.pieces ? +pk.pieces : undefined, value: pk.value ? +pk.value : undefined,
        destPincode: pk.destPincode || undefined, consigneeName: pk.consigneeName || undefined, consigneePhone: pk.consigneePhone || undefined });
      setMsg(r?.shipment?.booked ? `✓ Picked — AWB ${r.shipment.awb} booked to the customer (it will be billed).`
        : r?.shipment ? `✓ Picked — linked to the already-booked AWB ${r.shipment.awb}.`
        : pk.awb ? '✓ Picked. Add the destination pincode to book it for billing (or book the AWB separately).' : '✓ Marked picked.');
      setPickedFor(null); load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>{mode === 'book' ? '📦 Pickup Booking' : 'Pickup Requests'}</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      {(isClient || (isOps && mode === 'book')) && (
        <div className="card">
          <h2>Request a pickup</h2>
          {!isClient && (
            <div className="grid cols-3" style={{ marginBottom: 10 }}>
              <div><label>Customer code / name *</label><input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="search code or name…" /></div>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Customer *</label>
                <select value={custId} onChange={(e) => setCustId(e.target.value)}>
                  <option value="">— pick customer —</option>
                  {custShown.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="grid cols-3">
            <div style={{ gridColumn: 'span 2' }}><label>Pickup address *</label><input value={form.pickupAddress} onChange={(e) => set('pickupAddress', e.target.value)} /></div>
            <div><label>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div><label>Pincode <span className="muted" style={{ fontSize: 11 }}>(auto-fills city)</span></label><input value={form.pincode} onChange={(e) => onPincode(e.target.value)} /></div>
            <div><label>Contact name</label><input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></div>
            <div><label>Contact phone</label><input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></div>
            <div><label>No. of boxes</label><input type="number" value={form.estPieces} onChange={(e) => set('estPieces', e.target.value)} /></div>
            <div><label>Weight (kg)</label><input type="number" value={form.weight} onChange={(e) => set('weight', e.target.value)} /></div>
            <div>
              <label>Product</label>
              <select value={form.product} onChange={(e) => set('product', e.target.value)}>
                <option value="">— select product —</option>
                {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <label>Courier partner <span className="muted" style={{ fontSize: 11 }}>(your assigned carriers)</span></label>
              <select value={form.vendor} onChange={(e) => set('vendor', e.target.value)}>
                <option value="">— choose / assign later —</option>
                {formVendors.map((v) => <option key={v.code} value={v.code}>{isClient ? v.name : `${v.code} — ${v.name}`}</option>)}
              </select>
            </div>
            <div><label>Reference no. <span className="muted" style={{ fontSize: 11 }}>(trackable)</span></label><input value={form.refNo} onChange={(e) => set('refNo', e.target.value)} /></div>
            <div><label>Invoice no.</label><input value={form.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value)} /></div>
            <div><label>Invoice value ₹</label><input type="number" value={form.invoiceValue} onChange={(e) => set('invoiceValue', e.target.value)} /></div>
            <div><label>E-way bill no.</label><input value={form.ewbNo} onChange={(e) => set('ewbNo', e.target.value)} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Notes</label><input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          </div>
          <label className="row" style={{ gap: 6, marginTop: 10, fontSize: 13 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.isWarehouse} onChange={(e) => set('isWarehouse', e.target.checked)} /> Save this as a warehouse / regular pickup location</label>
          <button style={{ marginTop: 12 }} disabled={!form.pickupAddress || (!isClient && !custId)} onClick={create}>Request pickup</button>
          {!isClient && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Creates a pickup request (no AWB) — it appears in <a href="/pickups">Pickups</a> to hand off to a vendor. To book a shipment with an AWB at the door instead, use <a href="/pickup-book/awb">Book at pickup (AWB)</a>.</p>}
        </div>
      )}
      {mode === 'book' ? null : (<>

      {(isClient || isOps) && (
        <div className="card">
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>⬆ Bulk pickup upload {isOps ? '(many customers)' : ''}</summary>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Paste rows from Excel (copy cells — they come in tab-separated) or a CSV. One pickup per line.
              First row may be a header. Columns:
              <br /><code style={{ fontSize: 11 }}>{BULK_COLS}</code>
              {isOps && <><br /><b>accountCode</b> = the customer's code; unknown codes are reported and skipped.</>}
              <br />Pick a <b>vendor</b> below to apply to every row in this file, or leave it as <em>None</em> to assign the carrier later at booking. A per-row <code>vendor</code> column, if present, overrides this.
            </p>
            <div className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>Vendor for this upload
                <select value={bulkVendor} onChange={(e) => setBulkVendor(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">— None (assign at booking) —</option>
                  {vendors.map((v) => <option key={v.vendorCode} value={v.vendorCode}>{v.vendorCode} — {v.name}</option>)}
                </select>
              </label>
              <button className="secondary" style={{ padding: '5px 12px', fontSize: 12 }} onClick={downloadTemplate}>⬇ Download CSV template</button>
            </div>
            <textarea rows={6} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={BULK_COLS} />
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button disabled={bulkBusy || !bulkText.trim()} onClick={doBulk}>{bulkBusy ? 'Importing…' : 'Import pickups'}</button>
              {bulkResult && <span className="muted" style={{ fontSize: 13 }}>Imported <b>{bulkResult.created}</b>/{bulkResult.total}.</span>}
            </div>
            {bulkResult && bulkResult.results.some((r) => !r.ok) && (
              <div className="card" style={{ marginTop: 10, background: 'var(--bg-soft, #fbe9e6)', fontSize: 12.5 }}>
                <b>Skipped rows:</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {bulkResult.results.filter((r) => !r.ok).map((r, i) => <li key={i}>{r.row} — {r.error}</li>)}
                </ul>
              </div>
            )}
          </details>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ gap: 6, marginBottom: 10, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>Show:</span>
          {(['all', 'today', 'yesterday'] as const).map((k) => (
            <button key={k} className={dateFilter === k ? '' : 'secondary'} style={{ padding: '4px 12px', textTransform: 'capitalize' }} onClick={() => setDateFilter(k)}>{k}</button>
          ))}
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{visibleRows.length} pickup(s)</span>
        </div>
        <table>
          <thead><tr><th>#</th><th>Date</th>{isOps && <th>Customer</th>}<th>Product</th><th>From → To</th><th>Boxes</th><th>Wt</th><th>Status</th><th>Vendor token</th>{isOps && <th>Rider</th>}{isOps && <th></th>}</tr></thead>
          <tbody>
            {visibleRows.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td><td style={{ whiteSpace: 'nowrap' }}>{p.createdAt ? fmtDate(p.createdAt) : '—'}</td>
                {isOps && <td><button className="link" style={{ textAlign: 'left' }} onClick={() => openDetail(p)} title="View full pickup detail">{p.customerName ?? '—'}{p.customerCode ? <span className="muted" style={{ fontSize: 11 }}> ({p.customerCode})</span> : null}</button></td>}
                <td>{p.product ?? p.cargoMode ?? '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }} title={p.pickupAddress}>{[p.city, p.pincode].filter(Boolean).join(' · ') || '—'}</td>
                <td>{p.estPieces}</td>
                <td>{p.weight ? Number(p.weight) : '—'}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td>{p.token ? <span title={`${p.vendor || 'Carrier'} pickup token`}><b>{p.token}</b>{p.vendor ? <span className="muted" style={{ fontSize: 11 }}> · {p.vendor}</span> : null}</span> : <span className="muted">—</span>}</td>
                {isOps && <td>{p.status === 'ASSIGNED' || p.status === 'PICKED' ? riderLabel(p.assignedRiderId) : '—'}</td>}
                {isOps && (
                  <td className="row" style={{ gap: 6 }}>
                    <button className="secondary" onClick={() => openDetail(p)}>Details</button>
                    {!p.token && <button onClick={() => openHandoff(p)} title="Hand this pickup to a vendor — generates a pickup token">📅 Hand to vendor</button>}
                    {p.status === 'REQUESTED' && <button className="secondary" onClick={() => openAssign(p)}>Assign rider</button>}
                    {p.status === 'ASSIGNED' && <>
                      <button className="secondary" onClick={() => openAssign(p)}>Re-assign</button>
                      <button className="secondary" onClick={() => openPicked(p)}>Mark picked</button>
                    </>}
                  </td>
                )}
              </tr>
            ))}
            {visibleRows.length === 0 && <tr><td colSpan={12} className="muted">{rows.length ? `No pickups for ${dateFilter}.` : 'No pickup requests.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {isOps && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>🚚 BlueDart pickups</h2>
            <span className="muted" style={{ fontSize: 12 }}>{bdPickups.length} registered</span>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Collections registered with BlueDart (incl. outstation to-pay). The carrier waybill is
            auto-discovered by reference once BlueDart collects, and tracking then syncs automatically.
          </p>
          <table>
            <thead><tr><th>AWB</th><th>Token</th><th>Pickup</th><th>Route</th><th>Pcs</th><th>Pay</th><th>Stage</th><th>Waybill</th><th>Status</th><th>Synced</th><th></th></tr></thead>
            <tbody>
              {bdPickups.map((p) => (
                <tr key={p.awb}>
                  <td style={{ whiteSpace: 'nowrap' }}><a href={`/shipments/${p.awb}`}>{p.awb}</a></td>
                  <td>{p.token}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.pickupAt ? fmtDate(p.pickupAt) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.origin ?? '—'} → {p.dest ?? '—'}</td>
                  <td>{p.pieces}</td>
                  <td>{p.paymentTerm === 'TO_PAY' ? <span className="badge TO_PAY">TO-PAY</span> : <span className="muted" style={{ fontSize: 12 }}>PREPAID</span>}</td>
                  <td>{p.stage === 'PICKED' ? <span className="badge DELIVERED">PICKED</span> : <span className="badge CREATED">SCHEDULED</span>}</td>
                  <td>{p.waybill ?? <span className="muted" style={{ fontSize: 12 }}>pending</span>}</td>
                  <td>{p.status ? <span className="badge">{p.status}</span> : <span className="muted">—</span>}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>{p.syncedAt ? fmtDateTime(p.syncedAt) : '—'}</td>
                  <td><button className="secondary" style={{ padding: '4px 10px' }} disabled={bdSyncing === p.awb} onClick={() => syncBd(p.awb)}>{bdSyncing === p.awb ? '…' : '🔎 Sync'}</button></td>
                </tr>
              ))}
              {bdPickups.length === 0 && <tr><td colSpan={11} className="muted">No BlueDart pickups registered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <Modal title={`Assign rider — pickup #${assigning.id}`} width={460} onClose={() => setAssigning(null)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
            The rider you pick here is who sees this pickup in the Rider app. {assigning.pickupAddress}{assigning.city ? `, ${assigning.city}` : ''}
          </p>
          {riders.length === 0
            ? <div className="card" style={{ background: '#fff8e6', border: '1px solid #e6c34d', fontSize: 13 }}>No active riders yet — create one under <strong>Riders &amp; Drivers</strong> first.</div>
            : <>
                <label>Rider</label>
                <select value={selRider} onChange={(e) => setSelRider(e.target.value)}>
                  <option value="">— select a rider —</option>
                  {riders.map((r) => <option key={r.id} value={r.id}>{r.riderCode} · {r.fullName}{r.phone ? ` · ${r.phone}` : ''}</option>)}
                </select>
              </>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="secondary" onClick={() => setAssigning(null)}>Cancel</button>
            <button disabled={!selRider} onClick={doAssign}>Assign</button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Pickup request #${detail.id}`} width={560} onClose={() => setDetail(null)}>
          {detail.loading ? <p className="muted">Loading…</p> : (
            <>
              <div className="grid cols-2" style={{ gap: 10, fontSize: 13 }}>
                <div><div className="muted">Customer</div><strong>{detail.client?.legalName ?? '—'}{detail.client?.accountCode ? ` (${detail.client.accountCode})` : ''}</strong></div>
                <div><div className="muted">Status</div><span className={`badge ${detail.status}`}>{detail.status}</span></div>
                <div style={{ gridColumn: 'span 2' }}><div className="muted">Pickup address</div>{detail.pickupAddress}{detail.city ? `, ${detail.city}` : ''}{detail.pincode ? ` - ${detail.pincode}` : ''}</div>
                <div><div className="muted">Contact</div>{detail.contactName ?? '—'}{detail.contactPhone ? ` · ${detail.contactPhone}` : ''}</div>
                <div><div className="muted">Boxes · Mode</div>{detail.estPieces} · {detail.cargoMode ?? '—'}</div>
                <div><div className="muted">Invoice</div>{detail.invoiceNo ?? '—'}{detail.invoiceValue ? ` · ₹${Number(detail.invoiceValue).toLocaleString('en-IN')}` : ''}</div>
                <div><div className="muted">E-way bill</div>{detail.ewbNo ?? '—'}</div>
                {detail.notes && <div style={{ gridColumn: 'span 2' }}><div className="muted">Notes</div>{detail.notes}</div>}
                {detail.token && <div style={{ gridColumn: 'span 2' }}><div className="muted">Vendor pickup token</div><strong>{detail.token}</strong>{detail.vendor ? ` · ${detail.vendor}` : ''}{detail.handoffAt ? ` · ${fmtDateTime(detail.handoffAt)}` : ''}</div>}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 12 }}>{detail.token ? 'Already handed to the carrier — the token shows on the customer’s panel.' : 'Hand off to a vendor to generate a pickup token for this request.'}</span>
                <div className="row" style={{ gap: 8 }}>
                  <button className="secondary" onClick={() => setDetail(null)}>Close</button>
                  {!detail.token && isOps && <button onClick={() => { setDetail(null); openHandoff(detail); }}>📅 Hand off to vendor</button>}
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {handoffFor && (
        <Modal title={`Hand off pickup #${handoffFor.id} to a vendor`} width={560} onClose={() => setHandoffFor(null)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Pick the carrier (you can override the customer's choice). BlueDart registers the pickup and returns a token automatically; for any other vendor enter the token they give you (optional).</p>
          <div><label>Vendor</label>
            <select value={hVendor} onChange={(e) => setHVendor(e.target.value)}>
              <option value="">— select vendor —</option>
              {vendors.map((v) => <option key={v.vendorCode} value={v.vendorCode}>{v.vendorCode} — {v.name}</option>)}
            </select>
          </div>
          {needsDest(hVendor) ? (
            <div style={{ marginTop: 10 }}>
              {isXbVendor(hVendor) && <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>XpressBees books with the destination: this books the shipment, generates the <strong>XpressBees AWB</strong> and raises their pickup request (same-day only before 2 PM).</p>}
              <p className="muted" style={{ fontSize: 12, margin: '0 0 8px', display: isXbVendor(hVendor) ? 'none' : undefined }}>BlueDart books with the destination: this books the shipment for the customer and generates the <strong>BlueDart AWB</strong> (pickup registered with it). A pickup outside the account's home area goes as <strong>to-pay</strong> — billed to that account.</p>
              <div className="grid cols-2" style={{ gap: 8 }}>
                <div><label>Destination pincode *</label><input value={hd.destPincode} maxLength={6} onChange={(e) => setHd((x) => ({ ...x, destPincode: e.target.value }))} /></div>
                <div><label>Consignee mobile *</label><input value={hd.consigneePhone} onChange={(e) => setHd((x) => ({ ...x, consigneePhone: e.target.value }))} /></div>
                <div style={{ gridColumn: 'span 2' }}><label>Consignee name *</label><input value={hd.consigneeName} onChange={(e) => setHd((x) => ({ ...x, consigneeName: e.target.value }))} /></div>
                <div style={{ gridColumn: 'span 2' }}><label>Consignee address *</label><input value={hd.consigneeAddress} onChange={(e) => setHd((x) => ({ ...x, consigneeAddress: e.target.value }))} /></div>
                <div><label>Weight (kg)</label><input type="number" value={hd.weight} onChange={(e) => setHd((x) => ({ ...x, weight: e.target.value }))} /></div>
                <div><label>Boxes</label><input type="number" value={hd.pieces} onChange={(e) => setHd((x) => ({ ...x, pieces: e.target.value }))} /></div>
                <div style={{ gridColumn: 'span 2' }}><label>Invoice value ₹ *</label><input type="number" value={hd.value} onChange={(e) => setHd((x) => ({ ...x, value: e.target.value }))} /></div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}><label>Pickup token <span className="muted" style={{ fontSize: 11 }}>(from the vendor — optional)</span></label><input value={hToken} onChange={(e) => setHToken(e.target.value)} /></div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="secondary" onClick={() => setHandoffFor(null)}>Cancel</button>
            <button disabled={!hVendor || handingOff === String(handoffFor.id) || (needsDest(hVendor) && !handoffFor.pickedAwb && !(/^\d{6}$/.test(hd.destPincode) && hd.consigneeName && hd.consigneePhone && hd.consigneeAddress && Number(hd.value) > 0))} onClick={doHandoff}>{handingOff === String(handoffFor.id) ? 'Handing off…' : 'Hand off'}</button>
          </div>
        </Modal>
      )}

      {pickedFor && (
        <Modal title={`Mark picked — pickup #${pickedFor.id}`} width={460} onClose={() => setPickedFor(null)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Capture the actuals at pickup.</p>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div style={{ gridColumn: 'span 2' }}><label>AWB no.</label><input value={pk.awb} onChange={(e) => setPk((s) => ({ ...s, awb: e.target.value }))} /></div>
            <div><label>Weight (kg)</label><input type="number" value={pk.weight} onChange={(e) => setPk((s) => ({ ...s, weight: e.target.value }))} /></div>
            <div><label>Pieces</label><input type="number" value={pk.pieces} onChange={(e) => setPk((s) => ({ ...s, pieces: e.target.value }))} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Invoice value ₹</label><input type="number" value={pk.value} onChange={(e) => setPk((s) => ({ ...s, value: e.target.value }))} /></div>
            <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <strong style={{ fontSize: 12.5 }}>Book it for billing</strong>
              <div className="muted" style={{ fontSize: 11.5 }}>With an AWB + destination pincode the shipment is booked to this customer now (marked Picked) and goes on their bill. An AWB that's already booked is just linked.</div>
            </div>
            <div><label>Destination pincode</label><input value={pk.destPincode} maxLength={6} onChange={(e) => setPk((s) => ({ ...s, destPincode: e.target.value }))} /></div>
            <div><label>Consignee phone</label><input value={pk.consigneePhone} onChange={(e) => setPk((s) => ({ ...s, consigneePhone: e.target.value }))} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Consignee name</label><input value={pk.consigneeName} onChange={(e) => setPk((s) => ({ ...s, consigneeName: e.target.value }))} /></div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="secondary" onClick={() => setPickedFor(null)}>Cancel</button>
            <button onClick={doPicked}>Mark picked</button>
          </div>
        </Modal>
      )}
      </>)}
    </>
  );
}
