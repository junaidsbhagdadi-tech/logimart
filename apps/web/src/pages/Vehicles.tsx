import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';

// Linehaul + last-mile fleet, stored as MasterEntry type VEHICLE (code = reg no). A vehicle is
// used for hub-to-hub trips (Manifests) and, eventually, last-mile delivery runs.
const TYPES = ['Bike', 'Van', 'Tempo', 'Mini Truck', '8ft', '10ft', '14ft', '17ft', '20ft', '32FT SXL', '32ft MXL'];
const USES = ['BOTH', 'LINEHAUL', 'LAST_MILE'];
const blank = { code: '', type: '32FT SXL', owner: 'SELF', ownerContact: '', ownerEmail: '', capacityKg: '', useFor: 'BOTH' };

export function Vehicles() {
  const [rows, setRows] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [showAdd, setShowAdd] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.listMaster('VEHICLE').then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api.listVendors().then((v) => setVendors(v.filter((x: any) => x.isActive !== false))).catch(() => {});
  }, []);

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setError(''); setMsg('');
    if (!form.code.trim()) { setError('Registration number is required.'); return; }
    try {
      await api.saveMaster('VEHICLE', {
        code: form.code.trim().toUpperCase(), name: form.code.trim().toUpperCase(),
        attrs: { type: form.type, owner: form.owner, ownerContact: form.ownerContact || null, ownerEmail: form.ownerEmail || null, capacityKg: form.capacityKg ? Number(form.capacityKg) : null, useFor: form.useFor },
      });
      setMsg(`✓ Saved ${form.code.toUpperCase()}`); setForm({ ...blank }); setShowAdd(false); load();
    } catch (e: any) { setError(e.message); }
  };
  const del = async (code: string) => {
    if (!confirm(`Delete vehicle ${code}?`)) return;
    try { await api.deleteMaster('VEHICLE', code); load(); } catch (e: any) { setError(e.message); }
  };

  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => !s || r.code.toLowerCase().includes(s) || String(r.attrs?.owner ?? '').toLowerCase().includes(s) || String(r.attrs?.type ?? '').toLowerCase().includes(s));

  return (
    <>
      <h1>🚚 Vehicles</h1>
      <p className="muted" style={{ marginTop: -14 }}>Linehaul + last-mile fleet. Vehicles are picked on trip manifests (hub-to-hub) and, later, on delivery runs.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 4 }}>
        <button onClick={() => { setForm({ ...blank }); setShowAdd(true); }}>＋ Add Vehicle</button>
      </div>

      {showAdd && <Modal title="Add Vehicle" width={640} onClose={() => setShowAdd(false)}>
        <div className="grid cols-2">
          <div><label>Registration No *</label><input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="KA01AB1234" /></div>
          <div>
            <label>Type</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div>
            <label>Owner</label>
            <input list="lm-vehicle-owners" value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="SELF / owner or vendor name" />
            <datalist id="lm-vehicle-owners">
              <option value="SELF">SELF / Own fleet</option>
              {vendors.map((v) => <option key={v.id} value={v.name}>{v.vendorCode ? `${v.vendorCode} — ${v.name}` : v.name}</option>)}
            </datalist>
          </div>
          <div><label>Owner Contact</label><input value={form.ownerContact} onChange={(e) => set('ownerContact', e.target.value)} placeholder="phone / mobile" /></div>
          <div><label>Owner Email</label><input value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} placeholder="owner@example.com" /></div>
          <div><label>Capacity (kg)</label><input type="number" value={form.capacityKg} onChange={(e) => set('capacityKg', e.target.value)} /></div>
          <div>
            <label>Used for</label>
            <select value={form.useFor} onChange={(e) => set('useFor', e.target.value)}>{USES.map((u) => <option key={u} value={u}>{u === 'BOTH' ? 'Linehaul + Last-mile' : u === 'LINEHAUL' ? 'Linehaul only' : 'Last-mile only'}</option>)}</select>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          <button disabled={!form.code.trim()} onClick={create}>Add vehicle</button>
        </div>
      </Modal>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Vehicles ({rows.length})</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 reg / owner / type" style={{ width: 260 }} />
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Reg No</th><th>Type</th><th>Owner</th><th>Capacity</th><th>Used for</th><th></th></tr></thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.code}>
                <td><strong>{v.code}</strong></td>
                <td>{v.attrs?.type ?? '—'}</td>
                <td>{v.attrs?.owner === 'SELF' || !v.attrs?.owner ? <span className="badge DELIVERED">SELF</span> : <span className="badge AT_HUB">{v.attrs.owner}</span>}{(v.attrs?.ownerContact || v.attrs?.ownerEmail) && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{[v.attrs.ownerContact, v.attrs.ownerEmail].filter(Boolean).join(' · ')}</div>}</td>
                <td>{v.attrs?.capacityKg ? `${v.attrs.capacityKg} kg` : '—'}</td>
                <td>{v.attrs?.useFor ?? 'BOTH'}</td>
                <td><button className="secondary" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => del(v.code)}>🗑</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="muted">No vehicles yet — add your fleet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
