import { useEffect, useState } from 'react';
import { api } from '../api';

const MODES = ['EXPRESS', 'AIR_FREIGHT', 'OCEAN_FCL', 'OCEAN_LCL'];
const blank = { id: '', name: '', mode: 'EXPRESS', clientId: '', originScope: '', destScope: '', perKg: '', perCbm: '', perContainer: '', minCharge: '', fuelPct: '', volumetricDivisor: '', currency: 'USD', active: true };

export function IntlRateCards() {
  const [rows, setRows] = useState<any[]>([]);
  const [filterMode, setFilterMode] = useState('');
  const [f, setF] = useState<any>({ ...blank });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => { setErr(''); api.intlRateCards(filterMode || undefined).then(setRows).catch((e) => setErr(e.message)); };
  useEffect(load, [filterMode]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const edit = (c: any) => { setF({ id: c.id, name: c.name, mode: c.mode, clientId: c.clientId ?? '', originScope: c.originScope ?? '', destScope: c.destScope ?? '', perKg: c.perKg ?? '', perCbm: c.perCbm ?? '', perContainer: c.perContainer ?? '', minCharge: c.minCharge ?? '', fuelPct: c.fuelPct ?? '', volumetricDivisor: c.volumetricDivisor ?? '', currency: c.currency ?? 'USD', active: c.active }); setMsg(''); };
  const save = async () => { setErr(''); try { await api.intlSaveRateCard(f); setMsg('✓ Rate card saved.'); setF({ ...blank }); load(); } catch (e: any) { setErr(e.message); } };
  const del = async (id: string) => { if (!confirm('Delete this rate card?')) return; try { await api.intlDeleteRateCard(id); load(); } catch (e: any) { setErr(e.message); } };

  const ocean = f.mode === 'OCEAN_FCL' || f.mode === 'OCEAN_LCL';
  return (
    <>
      <h1>🌍 International rate cards</h1>
      <p className="muted" style={{ marginTop: -10, fontSize: 13 }}>Base freight rates used by the booking-screen quote. Leave <code>Customer</code> blank for a base rate; a customer-specific card overrides it. Scope by origin/dest country (blank = any).</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)' }}>{msg}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{f.id ? 'Edit' : 'New'} rate card</h2>
        <div className="grid cols-4" style={{ gap: 10 }}>
          <div><label>Name *</label><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Express IN→US base" /></div>
          <div><label>Mode *</label><select value={f.mode} onChange={(e) => set('mode', e.target.value)}>{MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
          <div><label>Customer ID <span className="muted">(blank = base)</span></label><input value={f.clientId} onChange={(e) => set('clientId', e.target.value)} placeholder="optional" /></div>
          <div><label>Currency</label><input value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></div>
          <div><label>Origin scope <span className="muted">(country)</span></label><input value={f.originScope} onChange={(e) => set('originScope', e.target.value)} placeholder="any" /></div>
          <div><label>Dest scope <span className="muted">(country)</span></label><input value={f.destScope} onChange={(e) => set('destScope', e.target.value)} placeholder="any" /></div>
          {!ocean && <div><label>Per kg</label><input type="number" value={f.perKg} onChange={(e) => set('perKg', e.target.value)} /></div>}
          {f.mode === 'OCEAN_LCL' && <div><label>Per CBM / RT</label><input type="number" value={f.perCbm} onChange={(e) => set('perCbm', e.target.value)} /></div>}
          {f.mode === 'OCEAN_FCL' && <div><label>Per container</label><input type="number" value={f.perContainer} onChange={(e) => set('perContainer', e.target.value)} /></div>}
          <div><label>Min charge</label><input type="number" value={f.minCharge} onChange={(e) => set('minCharge', e.target.value)} /></div>
          <div><label>Fuel %</label><input type="number" value={f.fuelPct} onChange={(e) => set('fuelPct', e.target.value)} /></div>
          {!ocean && <div><label>Vol divisor <span className="muted">(exp 5000 / air 6000)</span></label><input type="number" value={f.volumetricDivisor} onChange={(e) => set('volumetricDivisor', e.target.value)} /></div>}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}><label className="row" style={{ gap: 4, fontSize: 13, margin: 0 }}><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} style={{ width: 'auto' }} />Active</label></div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button onClick={save} disabled={!f.name || !f.mode}>{f.id ? 'Save changes' : 'Add rate card'}</button>
          {f.id && <button className="secondary" onClick={() => setF({ ...blank })}>Cancel edit</button>}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)}><option value="">All modes</option>{MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{rows.length} card(s)</span>
        </div>
        <table style={{ fontSize: 13 }}>
          <thead><tr><th>Name</th><th>Mode</th><th>Cust</th><th>Lane</th><th>Per kg</th><th>Per CBM</th><th>Per ctr</th><th>Min</th><th>Fuel%</th><th>Cur</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.mode}</td><td>{c.clientId ?? 'base'}</td><td>{(c.originScope || 'any')}→{(c.destScope || 'any')}</td>
                <td>{c.perKg ?? '—'}</td><td>{c.perCbm ?? '—'}</td><td>{c.perContainer ?? '—'}</td><td>{c.minCharge ?? '—'}</td><td>{c.fuelPct ?? '—'}</td><td>{c.currency}</td>
                <td>{c.active ? '✓' : '—'}</td>
                <td className="row" style={{ gap: 4 }}><button className="secondary" style={{ padding: '2px 8px' }} onClick={() => edit(c)}>✎</button><button className="secondary" style={{ padding: '2px 8px' }} onClick={() => del(c.id)}>🗑</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} className="muted">No rate cards yet — add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
