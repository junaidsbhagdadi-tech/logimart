import { useEffect, useState } from 'react';
import { api } from '../api';

const MODES = ['FTL', 'PTL', 'AIR', 'TRAIN'];
const blank = { name: '', gstin: '', pan: '', addressLine: '', city: '', state: '', pincode: '', contactName: '', contactPhone: '', contactEmail: '', modes: [] as string[] };

export function Vendors() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => { api.listVendors().then(setRows).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const toggleMode = (m: string) =>
    setForm((f) => ({ ...f, modes: f.modes.includes(m) ? f.modes.filter((x) => x !== m) : [...f.modes, m] }));

  const create = async () => {
    setError(''); setMsg('');
    try { await api.createVendor(form); setMsg(`Vendor ${form.name} added`); setForm({ ...blank }); load(); }
    catch (e: any) { setError(e.message); }
  };

  const addAdvance = async (id: string) => {
    const amt = prompt('Advance amount ₹:'); if (!amt) return;
    const paid = confirm('Is this advance already PAID? (Cancel = pending)');
    try { await api.addVendorPayment(id, { amount: +amt, kind: 'advance', status: paid ? 'paid' : 'pending' }); load(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Vendors</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Add vendor</h2>
        <div className="grid cols-3">
          <div><label>Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>GSTIN</label><input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
          <div><label>PAN</label><input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="AAAAA0000A" /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Address</label><input value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} /></div>
          <div><label>City</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><label>State</label><input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
          <div><label>Pincode</label><input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
          <div><label>Contact name</label><input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
          <div><label>Contact phone</label><input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></div>
          <div><label>Contact email</label><input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Modes served</label>
          <div className="row" style={{ gap: 14 }}>
            {MODES.map((m) => (
              <label key={m} className="row" style={{ gap: 5, alignItems: 'center' }}>
                <input type="checkbox" checked={form.modes.includes(m)} onChange={() => toggleMode(m)} style={{ width: 'auto' }} /> {m}
              </label>
            ))}
          </div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.name} onClick={create}>Add vendor</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Vendor</th><th>Modes</th><th>City</th><th>GSTIN</th><th>PAN</th><th>Advance paid</th><th>Advance pending</th><th></th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td><strong>{v.name}</strong><div className="muted" style={{ fontSize: 11 }}>{v.contactPhone}</div></td>
                <td>{v.modes}</td>
                <td>{v.city ?? '—'}</td>
                <td>{v.gstin ?? '—'}</td>
                <td>{v.pan ?? '—'}</td>
                <td>₹{Number(v.advancePaid).toLocaleString('en-IN')}</td>
                <td>{v.advancePending > 0 ? <span className="badge PARTIAL">₹{Number(v.advancePending).toLocaleString('en-IN')}</span> : '—'}</td>
                <td><button className="secondary" onClick={() => addAdvance(v.id)}>+ Advance</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">No vendors yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
