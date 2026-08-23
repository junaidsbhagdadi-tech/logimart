import { useEffect, useState } from 'react';
import { api, Client } from '../api';
import { Modal } from '../components/Modal';

const FTL_TYPES = ['8ft', '10ft', '14ft', '17ft', '20ft', '32FT SXL', '32ft MXL'];
const ftlBlank = { clientId: '', originZone: 'SOUTH', destZone: 'SOUTH', vehicleType: '32FT SXL', flatRate: '', fuelPct: '', gstPct: '18' };

/** Full-Truck-Load flat rates (per trip, by vehicle type). Separate from the per-kg/slab
 *  rate cards — FTL is priced by vehicle, not weight. */
export function FtlRates() {
  const [clients, setClients] = useState<Client[]>([]);
  const [ftlRows, setFtlRows] = useState<any[]>([]);
  const [ftlForm, setFtlForm] = useState({ ...ftlBlank });
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    api.listFtlRates().then(setFtlRows).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
  };
  useEffect(load, []);

  const setFtl = (k: keyof typeof ftlBlank, v: string) => setFtlForm((f) => ({ ...f, [k]: v }));
  const clientName = (id: string) => clients.find((c) => c.id === id)?.legalName ?? `#${id}`;

  const createFtl = async () => {
    setError(''); setMsg('');
    try {
      await api.createFtlRate({
        clientId: ftlForm.clientId ? +ftlForm.clientId : undefined,
        originZone: ftlForm.originZone, destZone: ftlForm.destZone, vehicleType: ftlForm.vehicleType,
        flatRate: +ftlForm.flatRate, fuelPct: ftlForm.fuelPct ? +ftlForm.fuelPct : 0,
        gstPct: ftlForm.gstPct !== '' ? +ftlForm.gstPct : 18,
      });
      setMsg('FTL rate added'); setFtlForm({ ...ftlBlank }); setShowAdd(false); load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>🚛 FTL Rates</h1>
      <p className="muted" style={{ marginTop: -14 }}>Full-Truck-Load flat rates per trip, by vehicle type — priced by vehicle, not weight. Blank customer = generic/one-time.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 4 }}>
        <button onClick={() => { setFtlForm({ ...ftlBlank }); setShowAdd(true); }}>＋ Add FTL rate</button>
      </div>

      {showAdd && <Modal title="Add FTL Rate" width={720} onClose={() => setShowAdd(false)}>
        <div className="grid cols-3">
          <div>
            <label>Customer (blank = generic/one-time)</label>
            <select value={ftlForm.clientId} onChange={(e) => setFtl('clientId', e.target.value)}>
              <option value="">— generic —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
            </select>
          </div>
          <div><label>Origin zone</label><input value={ftlForm.originZone} onChange={(e) => setFtl('originZone', e.target.value)} /></div>
          <div><label>Dest zone</label><input value={ftlForm.destZone} onChange={(e) => setFtl('destZone', e.target.value)} /></div>
          <div>
            <label>Vehicle type</label>
            <select value={ftlForm.vehicleType} onChange={(e) => setFtl('vehicleType', e.target.value)}>
              {FTL_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div><label>Flat rate ₹ (per trip) *</label><input type="number" value={ftlForm.flatRate} onChange={(e) => setFtl('flatRate', e.target.value)} /></div>
          <div><label>Fuel %</label><input type="number" value={ftlForm.fuelPct} onChange={(e) => setFtl('fuelPct', e.target.value)} /></div>
          <div><label>GST %</label><input type="number" value={ftlForm.gstPct} onChange={(e) => setFtl('gstPct', e.target.value)} placeholder="18" /></div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          <button disabled={!ftlForm.flatRate} onClick={createFtl}>Add FTL rate</button>
        </div>
      </Modal>}

      <div className="card">
        <table>
          <thead><tr><th>Customer</th><th>Lane</th><th>Vehicle</th><th>Flat ₹/trip</th><th>Fuel</th><th>GST</th></tr></thead>
          <tbody>
            {ftlRows.map((f) => (
              <tr key={f.id}>
                <td>{f.clientId ? clientName(String(f.clientId)) : 'Generic'}</td>
                <td>{f.originZone}→{f.destZone}</td>
                <td>{f.vehicleType}</td>
                <td>₹{f.flatRate}</td>
                <td>{f.fuelPct}%</td>
                <td>{f.gstPct ?? 18}%</td>
              </tr>
            ))}
            {ftlRows.length === 0 && <tr><td colSpan={6} className="muted">No FTL rates yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
