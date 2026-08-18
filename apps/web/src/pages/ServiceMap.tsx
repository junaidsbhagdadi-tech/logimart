import { useEffect, useState } from 'react';
import { api } from '../api';

// Integration carrier links Xpresion offers on the "Vendor Link" dropdown.
const VENDOR_LINKS = [
  '', 'AFTERSHIP', 'AIRWINGS', 'ANJANI COURIER', 'ARAMEX', 'ARAMEX NZ', 'ASYAD EXPRESS', 'ATLANTIC',
  'BLUEDART', 'BOMBINO', 'CANDA POST', 'CITY LINK', 'CITYLINK THAILAND', 'COURIERPLEASE AU', 'DELHIVERY',
  'DHL', 'DPD GERMANY', 'DPD UK', 'DPEX', 'DTDC', 'FEDEX', 'GATI', 'SPICEJET CARGO', 'TIRUPATI COURIER',
];

const blank = { vendor: '', serviceType: 'SELF', billingVendor: '', minWeight: '', maxWeight: '', vendorLink: '', isSinglePiece: false };

export function ServiceMap() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => { api.listServiceMappings().then(setRows).catch((e) => setError(e.message)); };
  useEffect(load, []);
  const set = (k: keyof typeof blank, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(''); setMsg('');
    if (!form.vendor) { setError('Vendor is required.'); return; }
    try { await api.addServiceMapping(form); setMsg(`✓ Mapping saved for ${form.vendor}.`); setForm({ ...blank }); load(); }
    catch (e: any) { setError(e.message); }
  };
  const remove = async (id: string) => {
    setError('');
    try { await api.delServiceMapping(id); load(); } catch (e: any) { setError(e.message); }
  };

  const filtered = rows.filter((r) => {
    const s = q.trim().toLowerCase();
    return !s || r.vendor?.toLowerCase().includes(s) || r.serviceType?.toLowerCase().includes(s) || r.billingVendor?.toLowerCase().includes(s);
  });

  return (
    <>
      <h1>🔀 Service Mapping</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <h2>Service</h2>
        <div className="grid cols-4">
          <div><label>Vendor *</label><input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="EXCELEX / BLUE DART DHL" /></div>
          <div><label>Service *</label><input value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)} placeholder="SELF / DHL / ARAMEX" /></div>
          <div><label>Billing Vendor</label><input value={form.billingVendor} onChange={(e) => set('billingVendor', e.target.value)} /></div>
          <div>
            <label>Vendor Link</label>
            <select value={form.vendorLink} onChange={(e) => set('vendorLink', e.target.value)}>
              {VENDOR_LINKS.map((v) => <option key={v} value={v}>{v || 'Select Vendor'}</option>)}
            </select>
          </div>
          <div><label>Min Weight</label><input type="number" value={form.minWeight} onChange={(e) => set('minWeight', e.target.value)} /></div>
          <div><label>Max Weight</label><input type="number" value={form.maxWeight} onChange={(e) => set('maxWeight', e.target.value)} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.isSinglePiece} onChange={(e) => set('isSinglePiece', e.target.checked)} /> Is Single Piece
            </label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button onClick={save}>Save</button></div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Mappings ({rows.length})</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 search vendor / service" style={{ width: 280 }} />
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Vendor</th><th>Service Type</th><th>Billing Vendor</th><th>Min Weight</th><th>Max Weight</th><th>Link</th><th>Single</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.vendor}</strong></td><td>{r.serviceType}</td><td>{r.billingVendor ?? '—'}</td>
                <td>{r.minWeight}</td><td>{r.maxWeight}</td><td>{r.vendorLink ?? '—'}</td>
                <td>{r.isSinglePiece ? '✓' : '—'}</td>
                <td><span className="badge DELIVERED">{r.isActive ? 'Active' : 'Inactive'}</span></td>
                <td><button className="secondary" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => remove(String(r.id))}>✕</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={9} className="muted">No mappings yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
