import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';

const MODES = ['FTL', 'PTL', 'AIR', 'TRAIN'];
const blank = {
  vendorCode: '', name: '', contactPerson: '', addressLine: '', addressLine2: '', pincode: '', city: '', state: '',
  tel1: '', tel2: '', fax: '', contactEmail: '', contactPhone: '', website: '', gstin: '', pan: '',
  mode: '', fuelHead: '', currency: 'INR', origin: '', vendorZip: '',
  isGlobal: false, gstEnabled: false, volRoundOff: false, modes: [] as string[],
};

export function Vendors() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());

  const load = () => { api.listVendors().then(setRows).catch((e) => setError(e.message)); setSel(new Set()); };
  useEffect(load, []);

  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = rows.length > 0 && sel.size === rows.length;
  const toggleSelAll = () => setSel(allSelected ? new Set() : new Set(rows.map((v) => String(v.id))));

  const bulkDelete = async () => {
    if (sel.size === 0) return;
    if (!confirm(`Delete ${sel.size} vendor${sel.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setError(''); setMsg('');
    let ok = 0, fail = 0;
    for (const id of sel) { try { await api.deleteVendor(id); ok++; } catch { fail++; } }
    setMsg(`Deleted ${ok} vendor${ok !== 1 ? 's' : ''}${fail ? ` — ${fail} could not be deleted (in use).` : '.'}`);
    load();
  };

  const toggleMode = (m: string) =>
    setForm((f) => ({ ...f, modes: f.modes.includes(m) ? f.modes.filter((x) => x !== m) : [...f.modes, m] }));

  const openEdit = (v: any) => {
    setEditing(v);
    setForm({ ...blank, ...v, modes: typeof v.modes === 'string' ? v.modes.split(',').filter(Boolean) : (v.modes || []) });
    setShowAdd(true); setError(''); setMsg('');
  };

  const create = async () => {
    setError(''); setMsg('');
    try {
      if (editing) { await api.updateVendor(editing.id, form); setMsg(`Vendor ${form.name} updated`); }
      else { await api.createVendor(form); setMsg(`Vendor ${form.name} added`); }
      setForm({ ...blank }); setEditing(null); setShowAdd(false); load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (v: any) => {
    if (!confirm(`Delete vendor ${v.name}? This cannot be undone.`)) return;
    try { await api.deleteVendor(v.id); load(); } catch (e: any) { setError(e.message); }
  };

  const addAdvance = async (id: string) => {
    const amt = prompt('Advance amount ₹:'); if (!amt) return;
    const paid = confirm('Is this advance already PAID? (Cancel = pending)');
    try { await api.addVendorPayment(id, { amount: +amt, kind: 'advance', status: paid ? 'paid' : 'pending' }); load(); }
    catch (e: any) { setError(e.message); }
  };

  const [upBusy, setUpBusy] = useState(false);
  const uploadVendors = async (f?: File) => {
    if (!f) return; setError(''); setMsg(''); setUpBusy(true);
    try {
      const { parseVendorSheet } = await import('../lib/rateSheet');
      const vrows = await parseVendorSheet(f);
      let ok = 0;
      for (const v of vrows) { try { await api.createVendor(v); ok++; } catch { /* dup / skip */ } }
      setMsg(`✓ Uploaded ${ok} / ${vrows.length} vendors (existing codes skipped)`); load();
    } catch (e: any) { setError(e.message); } finally { setUpBusy(false); }
  };

  return (
    <>
      <h1>Vendors</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong>⬆ Upload vendors</strong>
        <span className="muted" style={{ fontSize: 12 }}>Vendor Code · Name · Address · Phones · Contact · Email · GST · Currency template</span>
        <input type="file" accept=".xlsx,.xls,.csv" disabled={upBusy} onChange={(e) => uploadVendors(e.target.files?.[0])} />
        {upBusy && <span className="muted">Uploading…</span>}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 4 }}>
        <button onClick={() => { setEditing(null); setForm({ ...blank }); setShowAdd(true); }}>＋ Add Vendor</button>
      </div>

      {showAdd && <Modal title={editing ? `Edit ${editing.name}` : 'Add Vendor'} width={880} onClose={() => { setShowAdd(false); setEditing(null); }}>
        <div className="grid cols-4">
          <div><label>Vendor Code</label><input value={form.vendorCode} onChange={(e) => setForm({ ...form, vendorCode: e.target.value.toUpperCase() })} /></div>
          <div><label>Vendor Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>Contact Person</label><input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} /></div>
          <div><label>Address 1</label><input value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} /></div>

          <div><label>Address 2</label><input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></div>
          <div><label>Pin Code</label><input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
          <div><label>City</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><label>State</label><input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>

          <div><label>Telephone 1</label><input value={form.tel1} onChange={(e) => setForm({ ...form, tel1: e.target.value })} /></div>
          <div><label>Telephone 2</label><input value={form.tel2} onChange={(e) => setForm({ ...form, tel2: e.target.value })} /></div>
          <div><label>Fax</label><input value={form.fax} onChange={(e) => setForm({ ...form, fax: e.target.value })} /></div>
          <div><label>Email Id</label><input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>

          <div><label>Mobile</label><input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></div>
          <div><label>Web Site</label><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
          <div><label>GST No</label><input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} /></div>
          <div>
            <label>Mode</label>
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="">Select Type</option>{MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>

          <div><label>Fuel Head</label><input value={form.fuelHead} onChange={(e) => setForm({ ...form, fuelHead: e.target.value })} /></div>
          <div>
            <label>Currency</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option>INR</option><option>USD</option><option>EUR</option><option>GBP</option>
            </select>
          </div>
          <div><label>Origin</label><input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} /></div>
          <div><label>Vendor Zip</label><input value={form.vendorZip} onChange={(e) => setForm({ ...form, vendorZip: e.target.value })} /></div>

          <div><label>PAN</label><input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="AAAAA0000A" /></div>
        </div>
        <div className="row" style={{ gap: 20, marginTop: 12 }}>
          <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.isGlobal} onChange={(e) => setForm({ ...form, isGlobal: e.target.checked })} /> Global</label>
          <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.gstEnabled} onChange={(e) => setForm({ ...form, gstEnabled: e.target.checked })} /> GST</label>
          <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.volRoundOff} onChange={(e) => setForm({ ...form, volRoundOff: e.target.checked })} /> Volumetric Weight Round off</label>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Modes served</label>
          <div className="row" style={{ gap: 14 }}>
            {MODES.map((m) => (
              <label key={m} className="row" style={{ gap: 5, alignItems: 'center' }}>
                <input type="checkbox" checked={form.modes.includes(m)} onChange={() => toggleMode(m)} style={{ width: 'auto' }} /> {m}
              </label>
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          <button disabled={!form.name} onClick={create}>{editing ? 'Update vendor' : 'Add vendor'}</button>
        </div>
      </Modal>}

      <div className="card">
        {sel.size > 0 && (
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-soft, #f2f4f7)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
            <span><strong>{sel.size}</strong> selected</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="secondary" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setSel(new Set())}>Clear</button>
              <button style={{ padding: '4px 12px', fontSize: 13, background: 'var(--bad)' }} onClick={bulkDelete}>🗑 Delete selected</button>
            </div>
          </div>
        )}
        <table>
          <thead><tr><th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleSelAll} style={{ width: 'auto' }} /></th><th>Code</th><th>Vendor</th><th>Modes</th><th>City</th><th>GSTIN</th><th>PAN</th><th>Advance paid</th><th>Advance pending</th><th></th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} style={sel.has(String(v.id)) ? { background: 'var(--bg-soft, #f2f4f7)' } : undefined}>
                <td><input type="checkbox" checked={sel.has(String(v.id))} onChange={() => toggleSel(String(v.id))} style={{ width: 'auto' }} /></td>
                <td>{v.vendorCode ? <strong>{v.vendorCode}</strong> : <span className="muted">—</span>}</td>
                <td><strong>{v.name}</strong><div className="muted" style={{ fontSize: 11 }}>{v.contactPhone}</div></td>
                <td>{v.modes}</td>
                <td>{v.city ?? '—'}</td>
                <td>{v.gstin ?? '—'}</td>
                <td>{v.pan ?? '—'}</td>
                <td>₹{Number(v.advancePaid).toLocaleString('en-IN')}</td>
                <td>{v.advancePending > 0 ? <span className="badge PARTIAL">₹{Number(v.advancePending).toLocaleString('en-IN')}</span> : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => addAdvance(v.id)}>+ Advance</button>
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => openEdit(v)}>✎ Edit</button>
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => remove(v)}>🗑</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="muted">No vendors yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
