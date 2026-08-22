import { useEffect, useState } from 'react';
import { api } from '../api';

// Standard accessorial charges per mode (Apex / Surface) — shared by ALL vendors. Billing merges
// these under each rate card; a value on the card overrides the standard. Stored as MasterEntry
// type STD_ACCESSORIAL, code = mode, attrs.charges = { CODE: { value, min, perKg } }.
const MODES = ['APEX', 'SURFACE'] as const;
type Mode = (typeof MODES)[number];
const EXCLUDE = new Set(['FSC', 'FUEL', 'FREIGHT']);

export function StandardCharges() {
  const [mode, setMode] = useState<Mode>('APEX');
  const [chargeMaster, setChargeMaster] = useState<any[]>([]);
  const [store, setStore] = useState<Record<string, Record<string, any>>>({}); // mode -> charges
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [cm, entries] = await Promise.all([api.listMaster('CHARGE').catch(() => []), api.listMaster('STD_ACCESSORIAL').catch(() => [])]);
    setChargeMaster((cm as any[]).filter((c) => !EXCLUDE.has(String(c.code).toUpperCase())));
    const next: Record<string, Record<string, any>> = {};
    for (const e of entries as any[]) next[String(e.code).toUpperCase()] = (e.attrs?.charges as any) || {};
    setStore(next);
  };
  useEffect(() => { load(); }, []);

  const cur = store[mode] || {};
  const setCharge = (code: string, field: string, v: string) =>
    setStore((s) => ({ ...s, [mode]: { ...(s[mode] || {}), [code]: { ...((s[mode] || {})[code] || {}), [field]: v } } }));

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      await api.saveMaster('STD_ACCESSORIAL', { code: mode, name: `${mode} standard accessorials`, attrs: { charges: cur } });
      setMsg(`✓ Saved standard ${mode} accessorials (applies to all vendors).`); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h1>💱 Standard Accessorial Charges</h1>
      <p className="muted" style={{ marginTop: -14 }}>One standard set per mode, applied to <strong>all vendors</strong>. A value entered on a customer's rate card overrides the standard for that card. (ODA/EDL don't apply to DP.)</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong>Mode</strong>
        {MODES.map((m) => <button key={m} className={m === mode ? '' : 'secondary'} style={{ padding: '6px 16px' }} onClick={() => setMode(m)}>{m}</button>)}
        <button style={{ marginLeft: 'auto' }} onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save ${mode} standard`}</button>
      </div>

      <div className="card">
        {!chargeMaster.length ? <p className="muted">No charge types in the master. Add them under Masters → Charges.</p> : (
          <div className="grid cols-4" style={{ gap: 12 }}>
            {chargeMaster.map((c) => {
              const code = String(c.code).toUpperCase();
              const isEmergency = code === 'EMERGENCY', isAppt = code === 'APPT', isOda = code === 'ODA';
              const base = String(c.attrs?.baseOn || 'FLAT').toUpperCase();
              const pct = isEmergency || base === 'FREIGHT' || base.includes('VALUE');
              const unit = isEmergency ? '% of freight' : isAppt ? '₹/kg' : pct ? '%' : base.includes('WEIGHT') ? '₹/kg' : '₹';
              const showMin = isOda || isAppt || base.includes('VALUE');
              return (
                <div key={c.code}>
                  <label style={{ fontSize: 12 }}>{isOda ? `ODA — ${c.name}` : c.name} <span className="muted">({isOda ? 'flat + ₹/kg, min' : unit})</span></label>
                  <input type="number" step="0.001" value={cur[c.code]?.value ?? ''} onChange={(e) => setCharge(c.code, 'value', e.target.value)} placeholder={isOda ? 'flat ₹' : isAppt ? '₹/kg' : '0'} />
                  {showMin && <input type="number" style={{ marginTop: 4 }} value={cur[c.code]?.min ?? ''} onChange={(e) => setCharge(c.code, 'min', e.target.value)} placeholder="min ₹ (opt)" />}
                  {isOda && <input type="number" style={{ marginTop: 4 }} value={cur[c.code]?.perKg ?? ''} onChange={(e) => setCharge(c.code, 'perKg', e.target.value)} placeholder="₹/kg (opt)" />}
                </div>
              );
            })}
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Emergency = % of freight · Appointment = ₹/kg (chargeable) or min · ODA = flat + ₹/kg + min. FSC/fuel is set on the rate card, not here.</p>
      </div>
    </>
  );
}
