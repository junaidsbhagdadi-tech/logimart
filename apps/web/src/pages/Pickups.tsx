import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';

const blank = {
  pickupAddress: '', city: '', pincode: '', contactName: '', contactPhone: '', estPieces: '1',
  cargoMode: 'ROAD', invoiceNo: '', invoiceDate: '', invoiceValue: '', ewbNo: '', notes: '',
};

export function Pickups() {
  const { user } = useAuth();
  const isClient = user?.role === 'CLIENT_ADMIN';
  const isOps = ['HUB_MANAGER', 'SYS_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<any[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [assigning, setAssigning] = useState<any | null>(null); // the pickup being assigned
  const [selRider, setSelRider] = useState('');

  // Bulk upload (paste rows from Excel — tab-delimited — or a CSV). Ops rows carry an accountCode
  // per row; a client login is pinned to its own account so that column is ignored.
  const BULK_COLS = (isClient
    ? 'pickupAddress,city,pincode,contactName,contactPhone,estPieces,cargoMode,invoiceNo,invoiceDate,invoiceValue,ewbNo,notes'
    : 'accountCode,pickupAddress,city,pincode,contactName,contactPhone,estPieces,cargoMode,invoiceNo,invoiceDate,invoiceValue,ewbNo,notes');
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ total: number; created: number; results: { row: string; ok: boolean; error?: string }[] } | null>(null);
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
    try { const r = await api.bulkPickups(rows); setBulkResult(r); load(); }
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

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setError('');
    try {
      await api.createPickup({
        pickupAddress: form.pickupAddress,
        city: form.city || undefined,
        pincode: form.pincode || undefined,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        estPieces: form.estPieces ? +form.estPieces : 1,
        cargoMode: form.cargoMode || undefined,
        invoiceNo: form.invoiceNo || undefined,
        invoiceDate: form.invoiceDate || undefined,
        invoiceValue: form.invoiceValue ? +form.invoiceValue : undefined,
        ewbNo: form.ewbNo || undefined,
        notes: form.notes || undefined,
      });
      setForm({ ...blank });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const openAssign = (p: any) => { setAssigning(p); setSelRider(p.assignedRiderId != null ? String(p.assignedRiderId) : ''); setError(''); };
  const doAssign = async () => {
    if (!assigning || !selRider) return;
    try { await api.assignPickup(assigning.id, +selRider); setAssigning(null); load(); } catch (e: any) { setError(e.message); }
  };
  const complete = async (id: string) => {
    try { await api.completePickup(id); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Pickup Requests</h1>
      {error && <div className="error">{error}</div>}

      {isClient && (
        <div className="card">
          <h2>Request a pickup</h2>
          <div className="grid cols-3">
            <div style={{ gridColumn: 'span 2' }}><label>Pickup address *</label><input value={form.pickupAddress} onChange={(e) => set('pickupAddress', e.target.value)} /></div>
            <div><label>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div><label>Pincode</label><input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></div>
            <div><label>Contact name</label><input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></div>
            <div><label>Contact phone</label><input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></div>
            <div><label>No. of boxes</label><input type="number" value={form.estPieces} onChange={(e) => set('estPieces', e.target.value)} /></div>
            <div>
              <label>Cargo mode</label>
              <select value={form.cargoMode} onChange={(e) => set('cargoMode', e.target.value)}>
                {['ROAD', 'AIR', 'TRAIN', 'FTL', 'PTL'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div><label>Invoice no.</label><input value={form.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value)} /></div>
            <div><label>Invoice date</label><input type="date" value={form.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} /></div>
            <div><label>Invoice value ₹</label><input type="number" value={form.invoiceValue} onChange={(e) => set('invoiceValue', e.target.value)} /></div>
            <div><label>E-way bill no.</label><input value={form.ewbNo} onChange={(e) => set('ewbNo', e.target.value)} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Notes</label><input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          </div>
          <button style={{ marginTop: 12 }} disabled={!form.pickupAddress} onClick={create}>Request pickup</button>
        </div>
      )}

      {(isClient || isOps) && (
        <div className="card">
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>⬆ Bulk pickup upload {isOps ? '(many customers)' : ''}</summary>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Paste rows from Excel (copy cells — they come in tab-separated) or a CSV. One pickup per line.
              First row may be a header. Columns:
              <br /><code style={{ fontSize: 11 }}>{BULK_COLS}</code>
              {isOps && <><br /><b>accountCode</b> = the customer's code; unknown codes are reported and skipped.</>}
            </p>
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
        <table>
          <thead><tr><th>#</th><th>Address</th><th>City</th><th>Boxes</th><th>Status</th>{isOps && <th>Rider</th>}{isOps && <th></th>}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td><td>{p.pickupAddress}</td><td>{p.city ?? '—'}</td><td>{p.estPieces}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                {isOps && <td>{p.status === 'ASSIGNED' || p.status === 'PICKED' ? riderLabel(p.assignedRiderId) : '—'}</td>}
                {isOps && (
                  <td className="row" style={{ gap: 6 }}>
                    {p.status === 'REQUESTED' && <button className="secondary" onClick={() => openAssign(p)}>Assign rider</button>}
                    {p.status === 'ASSIGNED' && <>
                      <button className="secondary" onClick={() => openAssign(p)}>Re-assign</button>
                      <button className="secondary" onClick={() => complete(p.id)}>Mark picked</button>
                    </>}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No pickup requests.</td></tr>}
          </tbody>
        </table>
      </div>

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
    </>
  );
}
