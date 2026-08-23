import { useEffect, useState } from 'react';
import { api } from '../api';

const blank = { fullName: '', phone: '', vehicleNo: '', hubId: '', pin: '' };

export function Riders() {
  const [rows, setRows] = useState<any[]>([]);
  const [hubs, setHubs] = useState<{ id: string; code: string; name: string }[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  // Credential card shown once after create / PIN reset, with a copy button.
  const [cred, setCred] = useState<{ riderCode: string; pin: string; name: string; heading: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => { api.listRiders().then(setRows).catch((e) => setError(e.message)); };
  useEffect(() => { load(); }, []);
  useEffect(() => { api.listHubs().then(setHubs).catch(() => {}); }, []);

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const hubName = (id: any) => { const h = hubs.find((x) => String(x.id) === String(id)); return h ? `${h.code}` : '—'; };

  const credText = (c: { riderCode: string; pin: string }) =>
    `LogiMart Rider app login\nRider ID: ${c.riderCode}\nPIN: ${c.pin}\nOpen the LogiMart Rider app and sign in with your Rider ID + PIN.`;
  const copyCred = async () => {
    if (!cred) return;
    try { await navigator.clipboard.writeText(credText(cred)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* visible to copy */ }
  };

  const create = async () => {
    setError(''); setMsg(''); setCred(null);
    try {
      const r = await api.createRider({
        fullName: form.fullName,
        phone: form.phone || undefined,
        vehicleNo: form.vehicleNo || undefined,
        hubId: form.hubId ? +form.hubId : undefined,
        pin: form.pin || undefined,
      });
      setCred({ riderCode: r.riderCode, pin: r.pin, name: r.fullName, heading: `Rider created — ${r.fullName}` });
      setForm({ ...blank });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const toggle = async (r: any) => {
    try { await api.updateRider(r.id, { isActive: !r.isActive }); load(); } catch (e: any) { setError(e.message); }
  };
  const resetPin = async (r: any) => {
    setError(''); setMsg(''); setCred(null);
    const pin = prompt(`New PIN for ${r.fullName} (${r.riderCode}):\n\nLeave blank and press OK to auto-generate a 4-digit PIN.`);
    if (pin === null) return;
    try {
      const res = await api.resetRiderPin(r.id, pin.trim() || undefined);
      setCred({ riderCode: r.riderCode, pin: res.pin, name: r.fullName, heading: `PIN reset — ${r.fullName}` });
    } catch (e: any) { setError(e.message); }
  };
  const del = async (r: any) => {
    if (!confirm(`Delete rider ${r.fullName} (${r.riderCode})? This cannot be undone.`)) return;
    try { await api.deleteRider(r.id); setMsg(`Deleted ${r.riderCode}`); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>🛵 Riders &amp; Drivers</h1>
      <p className="muted" style={{ marginTop: -8 }}>Field staff who use the LogiMart Rider mobile app. Each rider signs in with their <strong>Rider ID + PIN</strong>.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}
      {cred && (
        <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <strong>🔐 {cred.heading}</strong>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={copyCred}>{copied ? '✓ Copied' : '📋 Copy login'}</button>
              <button className="secondary" onClick={() => setCred(null)}>Dismiss</button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>Hand these to the rider — the PIN is shown once. They sign into the Rider app with the Rider ID + PIN.</p>
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg, #f0f2f4)', borderRadius: 8, fontSize: 13, whiteSpace: 'pre-wrap' }}>{credText(cred)}</pre>
        </div>
      )}

      <div className="card">
        <h2>Add rider</h2>
        <div className="grid cols-3">
          <div><label>Full name *</label><input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Ramesh Kumar" /></div>
          <div><label>Mobile</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" /></div>
          <div><label>Vehicle no.</label><input value={form.vehicleNo} onChange={(e) => set('vehicleNo', e.target.value.toUpperCase())} placeholder="KA01AB1234" /></div>
          <div>
            <label>Home hub</label>
            <select value={form.hubId} onChange={(e) => set('hubId', e.target.value)}>
              <option value="">— none —</option>
              {hubs.map((h) => <option key={h.id} value={h.id}>{h.code} — {h.name}</option>)}
            </select>
          </div>
          <div><label>PIN <span className="muted">(blank = auto 4-digit)</span></label><input value={form.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} maxLength={6} placeholder="leave blank to auto-generate" /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.fullName} onClick={create}>Create rider</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Rider ID</th><th>Name</th><th>Mobile</th><th>Vehicle</th><th>Hub</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.riderCode}</strong></td>
                <td>{r.fullName}</td>
                <td>{r.phone || '—'}</td>
                <td>{r.vehicleNo || '—'}</td>
                <td>{hubName(r.hubId)}</td>
                <td><span className={`badge ${r.isActive ? 'DELIVERED' : 'CANCELLED'}`}>{r.isActive ? 'ACTIVE' : 'DISABLED'}</span></td>
                <td className="row" style={{ gap: 6 }}>
                  <button className="secondary" onClick={() => toggle(r)}>{r.isActive ? 'Disable' : 'Enable'}</button>
                  <button className="secondary" onClick={() => resetPin(r)}>Reset PIN</button>
                  <button className="secondary" title="Delete rider" onClick={() => del(r)}>🗑</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 18 }}>No riders yet — add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
