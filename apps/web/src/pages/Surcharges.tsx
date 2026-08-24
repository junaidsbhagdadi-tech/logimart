import { useEffect, useState } from 'react';
import { api } from '../api';

const OSW_DEFAULT = [
  { fromKg: 0, toKg: 30, perKg: '' },
  { fromKg: 31, toKg: 70, perKg: '' },
  { fromKg: 71, toKg: 200, perKg: '' },
  { fromKg: 201, toKg: 999999, perKg: '' },
];
const RAS_STATES = ['Bihar', 'Jharkhand', 'Jammu & Kashmir', 'Kerala'];
const slabLabel = (s: { fromKg: number; toKg: number }) => (s.toKg >= 999999 ? `${s.fromKg} kg & above` : `${s.fromKg}–${s.toKg} kg`);

export function Surcharges() {
  const [thresholdCm, setThresholdCm] = useState('119');
  const [slabs, setSlabs] = useState(OSW_DEFAULT.map((s) => ({ ...s })));
  const [rasPerKg, setRasPerKg] = useState('');
  const [rasStates, setRasStates] = useState<string[]>([...RAS_STATES]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listMaster('SETTING').then((rows) => {
      const osw = rows.find((r) => r.code === 'OSW');
      if (osw?.attrs) {
        if (osw.attrs.thresholdCm) setThresholdCm(String(osw.attrs.thresholdCm));
        if (Array.isArray(osw.attrs.slabs) && osw.attrs.slabs.length) setSlabs(osw.attrs.slabs.map((s: any) => ({ fromKg: Number(s.fromKg) || 0, toKg: Number(s.toKg) || 999999, perKg: s.perKg != null ? String(s.perKg) : '' })));
      }
      const ras = rows.find((r) => r.code === 'RAS');
      if (ras?.attrs) {
        if (ras.attrs.perKg != null) setRasPerKg(String(ras.attrs.perKg));
        if (Array.isArray(ras.attrs.states) && ras.attrs.states.length) setRasStates(ras.attrs.states);
      }
    }).catch(() => {});
  }, []);

  const saveOsw = async () => {
    setMsg(''); setError('');
    const clean = slabs.map((s) => ({ fromKg: Number(s.fromKg) || 0, toKg: Number(s.toKg) || 999999, perKg: Number(s.perKg) || 0 }));
    try {
      await api.saveMaster('SETTING', { code: 'OSW', name: 'OSW — Oversize/Overweight (₹/kg by slab)', attrs: { thresholdCm: Number(thresholdCm) || 119, slabs: clean }, active: true });
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

  return (
    <>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>📦 OSW — Oversize / Overweight</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Applies when <strong>any box dimension exceeds the threshold</strong>. Charged as <strong>chargeable weight (max of volumetric/actual) × the ₹/kg for its weight slab</strong>. Cargo products only.</p>
        <div style={{ maxWidth: 260 }}>
          <label>Dimension threshold (cm)</label>
          <input type="number" value={thresholdCm} onChange={(e) => setThresholdCm(e.target.value)} />
        </div>
        <table style={{ marginTop: 14, maxWidth: 460 }}>
          <thead><tr><th>Weight slab</th><th style={{ textAlign: 'right' }}>Rate (₹ / kg)</th></tr></thead>
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
    </>
  );
}
