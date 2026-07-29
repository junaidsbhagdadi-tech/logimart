import { useEffect, useState } from 'react';
import { api, Client, RateCardRow } from '../api';

const blank = {
  clientId: '', originZone: 'SOUTH', destZone: 'SOUTH', serviceMode: 'ROAD_PTL',
  perKgRate: '', minCharge: '', fuelPct: '',
  fovPct: '', fovMin: '', odaFlat: '', odaPerKg: '', odaMin: '', docketCharge: '', handlingCharge: '',
};

const MODES = ['AIR_EXPRESS', 'AIR_ECONOMY', 'ROAD_FTL', 'ROAD_PTL', 'RAIL'];
const FTL_TYPES = ['8ft', '10ft', '14ft', '17ft', '20ft', '32FT SXL', '32ft MXL'];
const ftlBlank = { clientId: '', originZone: 'SOUTH', destZone: 'SOUTH', vehicleType: '32FT SXL', flatRate: '', fuelPct: '' };

export function RateMatrix() {
  const [cards, setCards] = useState<RateCardRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [ftlRows, setFtlRows] = useState<any[]>([]);
  const [ftlForm, setFtlForm] = useState({ ...ftlBlank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    api.listRateCards().then(setCards).catch((e) => setError(e.message));
    api.listFtlRates().then(setFtlRows).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
  };
  useEffect(load, []);

  const setFtl = (k: keyof typeof ftlBlank, v: string) => setFtlForm((f) => ({ ...f, [k]: v }));
  const createFtl = async () => {
    setError(''); setMsg('');
    try {
      await api.createFtlRate({
        clientId: ftlForm.clientId ? +ftlForm.clientId : undefined,
        originZone: ftlForm.originZone, destZone: ftlForm.destZone, vehicleType: ftlForm.vehicleType,
        flatRate: +ftlForm.flatRate, fuelPct: ftlForm.fuelPct ? +ftlForm.fuelPct : 0,
      });
      setMsg('FTL rate added'); setFtlForm({ ...ftlBlank }); load();
    } catch (e: any) { setError(e.message); }
  };

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v ? +v : 0);

  const create = async () => {
    setError('');
    setMsg('');
    try {
      await api.createRateCard({
        clientId: +form.clientId,
        originZone: form.originZone,
        destZone: form.destZone,
        serviceMode: form.serviceMode,
        perKgRate: num(form.perKgRate),
        minCharge: num(form.minCharge),
        fuelPct: num(form.fuelPct),
        fovPct: num(form.fovPct),
        fovMin: num(form.fovMin),
        odaFlat: num(form.odaFlat),
        odaPerKg: num(form.odaPerKg),
        odaMin: num(form.odaMin),
        docketCharge: num(form.docketCharge),
        handlingCharge: num(form.handlingCharge),
      });
      setMsg('Rate card created');
      setForm({ ...blank });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const clientName = (id: string) => clients.find((c) => c.id === id)?.legalName ?? `#${id}`;

  return (
    <>
      <h1>Rate Matrix</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Add lane rate</h2>
        <div className="grid cols-3">
          <div>
            <label>Customer *</label>
            <select value={form.clientId} onChange={(e) => set('clientId', e.target.value)}>
              <option value="">— select —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
            </select>
          </div>
          <div><label>Origin zone</label><input value={form.originZone} onChange={(e) => set('originZone', e.target.value)} /></div>
          <div><label>Dest zone</label><input value={form.destZone} onChange={(e) => set('destZone', e.target.value)} /></div>
          <div>
            <label>Service mode</label>
            <select value={form.serviceMode} onChange={(e) => set('serviceMode', e.target.value)}>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div><label>Per-kg rate ₹ *</label><input type="number" value={form.perKgRate} onChange={(e) => set('perKgRate', e.target.value)} /></div>
          <div><label>Min charge ₹</label><input type="number" value={form.minCharge} onChange={(e) => set('minCharge', e.target.value)} /></div>
          <div><label>Fuel %</label><input type="number" value={form.fuelPct} onChange={(e) => set('fuelPct', e.target.value)} /></div>
          <div><label>FOV %</label><input type="number" value={form.fovPct} onChange={(e) => set('fovPct', e.target.value)} /></div>
          <div><label>FOV min ₹</label><input type="number" value={form.fovMin} onChange={(e) => set('fovMin', e.target.value)} /></div>
          <div><label>ODA flat ₹</label><input type="number" value={form.odaFlat} onChange={(e) => set('odaFlat', e.target.value)} /></div>
          <div><label>ODA per-kg ₹</label><input type="number" value={form.odaPerKg} onChange={(e) => set('odaPerKg', e.target.value)} /></div>
          <div><label>ODA min ₹</label><input type="number" value={form.odaMin} onChange={(e) => set('odaMin', e.target.value)} /></div>
          <div><label>Docket ₹</label><input type="number" value={form.docketCharge} onChange={(e) => set('docketCharge', e.target.value)} /></div>
          <div><label>Handling ₹</label><input type="number" value={form.handlingCharge} onChange={(e) => set('handlingCharge', e.target.value)} /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.clientId || !form.perKgRate} onClick={create}>Add rate card</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Customer</th><th>Lane</th><th>Mode</th><th>₹/kg</th><th>Min</th><th>Fuel</th><th>FOV</th><th>ODA</th><th>Docket</th></tr></thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <td>{clientName(c.clientId)}</td>
                <td>{c.originZone}→{c.destZone}</td>
                <td>{c.serviceMode}</td>
                <td>₹{c.perKgRate}</td>
                <td>₹{c.minCharge}</td>
                <td>{c.fuelPct}%</td>
                <td>{c.fovPct}% / ₹{c.fovMin}</td>
                <td>₹{c.odaFlat}+₹{c.odaPerKg}/kg</td>
                <td>₹{c.docketCharge}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>🚛 FTL rates (per trip, by vehicle type)</h2>
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
        </div>
        <button style={{ marginTop: 12 }} disabled={!ftlForm.flatRate} onClick={createFtl}>Add FTL rate</button>

        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Customer</th><th>Lane</th><th>Vehicle</th><th>Flat ₹/trip</th><th>Fuel</th></tr></thead>
          <tbody>
            {ftlRows.map((f) => (
              <tr key={f.id}>
                <td>{f.clientId ? clientName(String(f.clientId)) : 'Generic'}</td>
                <td>{f.originZone}→{f.destZone}</td>
                <td>{f.vehicleType}</td>
                <td>₹{f.flatRate}</td>
                <td>{f.fuelPct}%</td>
              </tr>
            ))}
            {ftlRows.length === 0 && <tr><td colSpan={5} className="muted">No FTL rates yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
