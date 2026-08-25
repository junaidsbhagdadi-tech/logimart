import { useEffect, useState } from 'react';
import { api } from '../api';

const OSW_DEFAULT = [
  { fromKg: 0, toKg: 30, perKg: '' },
  { fromKg: 31, toKg: 70, perKg: '' },
  { fromKg: 71, toKg: 200, perKg: '' },
  { fromKg: 201, toKg: 999999, perKg: '' },
];
const RAS_STATES = ['Bihar', 'Jharkhand', 'Jammu & Kashmir', 'Kerala'];
const MCC_CITIES = [
  { code: 'BOM', name: 'Mumbai' }, { code: 'DEL', name: 'Delhi' }, { code: 'GGN', name: 'Gurgaon' },
  { code: 'NDA', name: 'Noida' }, { code: 'MAA', name: 'Chennai' }, { code: 'BLR', name: 'Bangalore' },
  { code: 'HYD', name: 'Hyderabad' }, { code: 'AHD', name: 'Ahmedabad' }, { code: 'CCU', name: 'Kolkata' },
];
const slabLabel = (s: { fromKg: number; toKg: number }) => (s.toKg >= 999999 ? `${s.fromKg} kg & above` : `${s.fromKg}–${s.toKg} kg`);

export function Surcharges() {
  const [thresholdCm, setThresholdCm] = useState('119');
  const [thresholdKg, setThresholdKg] = useState('69');
  const [slabs, setSlabs] = useState(OSW_DEFAULT.map((s) => ({ ...s })));
  const [rasPerKg, setRasPerKg] = useState('');
  const [rasStates, setRasStates] = useState<string[]>([...RAS_STATES]);
  const [mccCities, setMccCities] = useState<string[]>(MCC_CITIES.map((c) => c.code));
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listMaster('SETTING').then((rows) => {
      const osw = rows.find((r) => r.code === 'OSW');
      if (osw?.attrs) {
        if (osw.attrs.thresholdCm) setThresholdCm(String(osw.attrs.thresholdCm));
        if (osw.attrs.thresholdKg) setThresholdKg(String(osw.attrs.thresholdKg));
        if (Array.isArray(osw.attrs.slabs) && osw.attrs.slabs.length) setSlabs(osw.attrs.slabs.map((s: any) => ({ fromKg: Number(s.fromKg) || 0, toKg: Number(s.toKg) || 999999, perKg: s.perKg != null ? String(s.perKg) : '' })));
      }
      const ras = rows.find((r) => r.code === 'RAS');
      if (ras?.attrs) {
        if (ras.attrs.perKg != null) setRasPerKg(String(ras.attrs.perKg));
        if (Array.isArray(ras.attrs.states) && ras.attrs.states.length) setRasStates(ras.attrs.states);
      }
      const mcc = rows.find((r) => r.code === 'MCC');
      if (mcc?.attrs && Array.isArray(mcc.attrs.cities) && mcc.attrs.cities.length) setMccCities(mcc.attrs.cities.map((c: any) => String(c).toUpperCase()));
    }).catch(() => {});
  }, []);

  const saveOsw = async () => {
    setMsg(''); setError('');
    const clean = slabs.map((s) => ({ fromKg: Number(s.fromKg) || 0, toKg: Number(s.toKg) || 999999, perKg: Number(s.perKg) || 0 }));
    try {
      await api.saveMaster('SETTING', { code: 'OSW', name: 'OSW — Oversize/Overweight (₹/kg by slab)', attrs: { thresholdCm: Number(thresholdCm) || 119, thresholdKg: Number(thresholdKg) || 69, slabs: clean }, active: true });
      setMsg('✓ OSW saved.');
    } catch (e: any) { setError(e.message); }
  };
  const saveRas = async () => {
    setMsg(''); setError('');
    try {
      await api.saveMaster('SETTING', { code: 'RAS', name: 'RAS — Remote Area Surcharge (₹/kg)', attrs: { perKg: Number(rasPerKg) || 0, states: rasStates }, active: true });
      setMsg('✓ RAS saved.');
    } catch (e: any) { setError(e.message); }
  };
  const toggleState = (s: string) => setRasStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const toggleCity = (c: string) => setMccCities((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const saveMcc = async () => {
    setMsg(''); setError('');
    try {
      await api.saveMaster('SETTING', { code: 'MCC', name: 'MCC — Metro Congestion Charge (metro cities)', attrs: { cities: mccCities }, active: true });
      setMsg('✓ MCC cities saved.');
    } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>📦 OSW — Oversize / Overweight</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Applies when <strong>any box dimension exceeds the cm threshold</strong> <em>or</em> <strong>any piece exceeds the kg threshold</strong>. Charged <strong>per oversized piece × the ₹/pcs for the shipment's weight slab</strong>. Cargo products only.</p>
        <div className="row" style={{ gap: 14 }}>
          <div style={{ maxWidth: 200 }}>
            <label>Dimension threshold (cm)</label>
            <input type="number" value={thresholdCm} onChange={(e) => setThresholdCm(e.target.value)} />
          </div>
          <div style={{ maxWidth: 200 }}>
            <label>Weight threshold (kg)</label>
            <input type="number" value={thresholdKg} onChange={(e) => setThresholdKg(e.target.value)} />
          </div>
        </div>
        <table style={{ marginTop: 14, maxWidth: 460 }}>
          <thead><tr><th>Weight slab</th><th style={{ textAlign: 'right' }}>Rate (₹ / pcs)</th></tr></thead>
          <tbody>
            {slabs.map((s, i) => (
              <tr key={i}>
                <td>{slabLabel(s)}</td>
                <td style={{ textAlign: 'right' }}><input type="number" value={s.perKg} onChange={(e) => setSlabs((cur) => cur.map((x, idx) => idx === i ? { ...x, perKg: e.target.value } : x))} style={{ width: 120, textAlign: 'right' }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={{ marginTop: 14 }} onClick={saveOsw}>Save OSW</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>🗺 RAS — Remote Area Surcharge</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>A <strong>per-kg</strong> surcharge on <strong>all cargo shipments</strong> delivered to the selected states (charged on chargeable weight).</p>
        <div style={{ maxWidth: 260 }}>
          <label>Rate (₹ / kg)</label>
          <input type="number" value={rasPerKg} onChange={(e) => setRasPerKg(e.target.value)} />
        </div>
        <label style={{ marginTop: 14, display: 'block' }}>Applicable destination states</label>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
          {RAS_STATES.map((s) => (
            <label key={s} className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={rasStates.includes(s)} onChange={() => toggleState(s)} /> {s}
            </label>
          ))}
        </div>
        <button style={{ marginTop: 16 }} onClick={saveRas}>Save RAS</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>🏙 MCC — Metro Congestion Charge</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>The Metro Congestion Charge (a rate-card charge) is billed <strong>only</strong> when the shipment's <strong>origin or destination</strong> is one of these metros. Set the ₹ rate on the customer's rate card (charge code <strong>MCC</strong>); this list controls where it applies.</p>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
          {MCC_CITIES.map((c) => (
            <label key={c.code} className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={mccCities.includes(c.code)} onChange={() => toggleCity(c.code)} /> {c.name} <span className="muted" style={{ fontWeight: 400 }}>({c.code})</span>
            </label>
          ))}
        </div>
        <button style={{ marginTop: 16 }} onClick={saveMcc}>Save MCC cities</button>
      </div>
    </>
  );
}
