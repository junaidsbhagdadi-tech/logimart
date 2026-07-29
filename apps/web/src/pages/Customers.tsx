import { useEffect, useState } from 'react';
import { api, Client } from '../api';

const blank = {
  legalName: '', gstin: '', pan: '', addressLine: '', city: '', pincode: '',
  contactName: '', contactPhone: '', contactEmail: '',
  creditLimit: '', creditDays: '30', isOneTime: false,
};

export function Customers() {
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const toggleActive = async (c: Client) => {
    setError('');
    try {
      await api.updateClient(c.id, { isActive: !c.isActive });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const create = async () => {
    setError('');
    setMsg('');
    try {
      const c = await api.createClient({
        legalName: form.legalName,
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
        addressLine: form.addressLine || undefined,
        city: form.city || undefined,
        pincode: form.pincode || undefined,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        contactEmail: form.contactEmail || undefined,
        creditLimit: form.creditLimit ? +form.creditLimit : 0,
        creditDays: form.creditDays ? +form.creditDays : 30,
        isOneTime: form.isOneTime,
      });
      setMsg(`Created ${c.legalName} (${c.accountCode})`);
      setForm({ ...blank });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <h1>Customers</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Onboard customer</h2>
        <div className="grid cols-3">
          <div><label>Legal name *</label><input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} /></div>
          <div><label>GSTIN</label><input value={form.gstin} onChange={(e) => set('gstin', e.target.value)} /></div>
          <div><label>PAN</label><input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} placeholder="AAAAA0000A" /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Address</label><input value={form.addressLine} onChange={(e) => set('addressLine', e.target.value)} /></div>
          <div><label>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div><label>Pincode</label><input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></div>
          <div><label>Contact name</label><input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></div>
          <div><label>Contact phone</label><input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></div>
          <div><label>Contact email</label><input value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></div>
          <div><label>Credit limit (₹)</label><input type="number" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} /></div>
          <div><label>Credit days</label><input type="number" value={form.creditDays} onChange={(e) => set('creditDays', e.target.value)} /></div>
          <div><label>&nbsp;</label><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.isOneTime} onChange={(e) => setForm((f) => ({ ...f, isOneTime: e.target.checked }))} style={{ width: 'auto' }} /> One-time / walk-in customer</label></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.legalName} onClick={create}>Create customer</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>GSTIN</th><th>PAN</th><th>City</th><th>Credit limit</th><th>Outstanding</th><th>Terms</th><th>Status</th><th>Active</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} style={{ opacity: c.isActive === false ? 0.5 : 1 }}>
                <td>{c.accountCode}</td><td><strong>{c.legalName}</strong></td><td>{c.gstin ?? '—'}</td><td>{c.pan ?? '—'}</td>
                <td>{c.city ?? '—'}</td><td>₹{c.creditLimit}</td><td>₹{c.outstandingBal}</td>
                <td>Net {c.creditDays}</td>
                <td>{c.isCreditHold ? <span className="badge PARTIAL">HOLD</span> : <span className="badge DELIVERED">OK</span>}</td>
                <td>
                  <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => toggleActive(c)}>
                    {c.isActive === false ? 'Activate' : 'Deactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
