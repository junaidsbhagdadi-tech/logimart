import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from './Modal';

/** Manage a vendor's branch/location contacts (multiple per location, optionally product-wise). */
export function VendorContactsDialog({ vendor, onClose }: { vendor: { id: string | number; name: string }; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ location: '', product: '', personName: '', phone: '', email: '', role: '' });
  const [err, setErr] = useState('');

  const load = () => { api.listVendorContacts(vendor.id).then(setRows).catch((e) => setErr(e.message)); };
  useEffect(load, [vendor.id]);

  const add = async () => {
    setErr('');
    try { await api.addVendorContact(vendor.id, form); setForm({ location: '', product: '', personName: '', phone: '', email: '', role: '' }); load(); }
    catch (e: any) { setErr(e.message); }
  };
  const del = async (id: string) => { if (!confirm('Delete this contact?')) return; try { await api.deleteVendorContact(id); load(); } catch (e: any) { setErr(e.message); } };

  return (
    <Modal title={`📇 Branch contacts — ${vendor.name}`} width={760} onClose={onClose}>
      {err && <div className="error">{err}</div>}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Add one row per person. Multiple contacts per location (and optionally per product) are fine — they show on the tracker so the team knows who to call for each hop (origin / destination / in‑between).</p>
      <div className="grid cols-3" style={{ gap: 10 }}>
        <div><label>Location / branch *</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. AHMEDABAD" /></div>
        <div><label>Contact name *</label><input value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} /></div>
        <div><label>Role</label><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Branch Manager / Ops" /></div>
        <div><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label>Product <span className="muted">(optional)</span></label><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="all products" /></div>
      </div>
      <button className="secondary" style={{ marginTop: 10 }} disabled={!form.location.trim() || !form.personName.trim()} onClick={add}>➕ Add contact</button>

      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table style={{ fontSize: 13 }}>
          <thead><tr><th>Location</th><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th>Product</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.location}</strong></td><td>{c.personName}</td><td>{c.role || '—'}</td><td>{c.phone || '—'}</td><td>{c.email || '—'}</td><td>{c.product || 'all'}</td>
                <td><button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => del(c.id)}>🗑</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted">No contacts yet — add the vendor's branch contacts above.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
