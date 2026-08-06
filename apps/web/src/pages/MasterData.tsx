import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const REGIONS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTHEAST'];
type Pin = { pincode: string; city: string; state: string; region: string; tier: number; isOda: boolean };
type Hub = { id: string; code: string; name: string; zone: string };

export function MasterData() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [p, setP] = useState<Pin>({ pincode: '', city: '', state: '', region: 'SOUTH', tier: 2, isOda: false });
  const [h, setH] = useState<Hub>({ id: '', code: '', name: '', zone: 'SOUTH' });

  const load = () => {
    api.listPincodes().then(setPins).catch((e) => setError(e.message));
    api.listHubs().then(setHubs).catch(() => {});
  };
  useEffect(load, []);

  const addPin = async () => {
    setError(''); setMsg('');
    if (!/^\d{6}$/.test(p.pincode)) { setError('Pincode must be 6 digits.'); return; }
    if (!p.city || !p.state) { setError('City and state are required.'); return; }
    try {
      await api.createPincode({ ...p, tier: Number(p.tier) });
      setMsg(`✓ ${p.pincode} — ${p.city} is now serviceable.`);
      setP({ pincode: '', city: '', state: '', region: p.region, tier: p.tier, isOda: false });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const addHub = async () => {
    setError(''); setMsg('');
    if (!h.code || !h.name) { setError('Hub code and name are required.'); return; }
    try {
      await api.createHub({ code: h.code, name: h.name, zone: h.zone });
      setMsg(`✓ Hub ${h.code.toUpperCase()} added.`);
      setH({ id: '', code: '', name: '', zone: h.zone });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pins;
    return pins.filter((x) => x.pincode.startsWith(s) || x.city.toLowerCase().includes(s) || x.state.toLowerCase().includes(s));
  }, [pins, q]);

  return (
    <>
      <h1>🗺 Serviceability &amp; Hubs</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <h2>Add serviceable pincode / city</h2>
        <div className="grid cols-3">
          <div><label>Pincode *</label><input value={p.pincode} maxLength={6} onChange={(e) => setP({ ...p, pincode: e.target.value })} placeholder="560001" /></div>
          <div><label>City *</label><input value={p.city} onChange={(e) => setP({ ...p, city: e.target.value })} placeholder="Bengaluru" /></div>
          <div><label>State *</label><input value={p.state} onChange={(e) => setP({ ...p, state: e.target.value })} placeholder="Karnataka" /></div>
          <div>
            <label>Region</label>
            <select value={p.region} onChange={(e) => setP({ ...p, region: e.target.value })}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label>Tier</label>
            <select value={p.tier} onChange={(e) => setP({ ...p, tier: Number(e.target.value) })}>
              <option value={1}>Tier 1 (metro)</option>
              <option value={2}>Tier 2</option>
              <option value={3}>Tier 3</option>
            </select>
          </div>
          <div>
            <label>Out-of-delivery-area (ODA)</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--text)', marginTop: 4, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={p.isOda} onChange={(e) => setP({ ...p, isOda: e.target.checked })} /> ODA surcharge applies
            </label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}><button onClick={addPin}>+ Add pincode</button></div>
      </div>

      <div className="card">
        <h2>Add hub</h2>
        <div className="grid cols-3">
          <div><label>Hub code *</label><input value={h.code} onChange={(e) => setH({ ...h, code: e.target.value.toUpperCase() })} placeholder="BLR" /></div>
          <div><label>Hub name *</label><input value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} placeholder="Bengaluru Hub" /></div>
          <div>
            <label>Zone</label>
            <select value={h.zone} onChange={(e) => setH({ ...h, zone: e.target.value })}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}><button onClick={addHub}>+ Add hub</button></div>
        {hubs.length > 0 && (
          <table style={{ marginTop: 14 }}>
            <thead><tr><th>Code</th><th>Name</th><th>Zone</th></tr></thead>
            <tbody>{hubs.map((x) => <tr key={x.id}><td><strong>{x.code}</strong></td><td>{x.name}</td><td><span className="badge CREATED">{x.zone}</span></td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Serviceable pincodes ({pins.length})</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 filter city / pincode / state" style={{ width: 280 }} />
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Pincode</th><th>City</th><th>State</th><th>Region</th><th>Tier</th><th>ODA</th></tr></thead>
          <tbody>
            {filtered.slice(0, 300).map((x) => (
              <tr key={x.pincode}>
                <td><strong>{x.pincode}</strong></td><td>{x.city}</td><td>{x.state}</td>
                <td><span className="badge CREATED">{x.region}</span></td><td>{x.tier}</td>
                <td>{x.isOda ? <span className="badge PARTIAL">ODA</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="muted">No pincodes match.</p>}
      </div>
    </>
  );
}
