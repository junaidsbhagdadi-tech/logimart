import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

const blank = {
  pickupAddress: '', city: '', pincode: '', contactName: '', contactPhone: '', estPieces: '1',
  cargoMode: 'ROAD', invoiceNo: '', invoiceDate: '', invoiceValue: '', ewbNo: '', notes: '',
};

export function Pickups() {
  const { user } = useAuth();
  const isClient = user?.role === 'CLIENT_ADMIN';
  const isOps = ['HUB_MANAGER', 'SYS_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');

  const load = () => {
    api.listPickups().then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, []);

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

  const assign = async (id: string) => {
    const rider = prompt('Rider user id to assign:');
    if (!rider) return;
    try { await api.assignPickup(id, +rider); load(); } catch (e: any) { setError(e.message); }
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

      <div className="card">
        <table>
          <thead><tr><th>#</th><th>Address</th><th>City</th><th>Boxes</th><th>Status</th>{isOps && <th></th>}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td><td>{p.pickupAddress}</td><td>{p.city ?? '—'}</td><td>{p.estPieces}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                {isOps && (
                  <td>
                    {p.status === 'REQUESTED' && <button className="secondary" onClick={() => assign(p.id)}>Assign</button>}
                    {p.status === 'ASSIGNED' && <button className="secondary" onClick={() => complete(p.id)}>Mark picked</button>}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No pickup requests.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
