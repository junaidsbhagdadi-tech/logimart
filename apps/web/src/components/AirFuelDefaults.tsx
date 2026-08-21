import { useEffect, useState } from 'react';
import { api } from '../api';

// Air fuel surcharge defaults, stored as FLAT FUEL_MECHANISM entries flagged { airDefault, isDefault }.
// "Same for all" = one entry with blank network. "Per vendor" = one entry per network (SELF + vendors).
// Billing (cardFuelPct) inherits these for air/express/DP cards that leave Fuel % blank — a
// network-specific default beats the all-vendors one.
const ALL_CODE = 'AIRFUEL';
const vcode = (v: any) => String(v.vendorCode || v.name).toUpperCase();

export function AirFuelDefaults({ onSaved }: { onSaved?: () => void }) {
  const [vendors, setVendors] = useState<any[]>([]);
  const [mode, setMode] = useState<'ALL' | 'VENDOR'>('ALL');
  const [allPct, setAllPct] = useState('');
  const [perVendor, setPerVendor] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // SELF (own network) + every vendor are the possible per-network targets.
  const targets = [{ code: 'SELF', name: 'SELF / Own network' }, ...vendors.map((v) => ({ code: vcode(v), name: v.name }))];

  const load = async () => {
    const [vs, ms] = await Promise.all([api.listVendors().catch(() => []), api.listMaster('FUEL_MECHANISM').catch(() => [])]);
    setVendors((vs as any[]).filter((v) => v.isActive !== false));
    const air = (ms as any[]).filter((m) => (m.attrs as any)?.airDefault);
    const perV: Record<string, string> = {};
    let all = '';
    for (const a of air) {
      const net = String((a.attrs as any)?.network ?? '').trim().toUpperCase();
      const pct = String((a.attrs as any)?.percentage ?? '');
      if (net) perV[net] = pct; else all = pct;
    }
    if (Object.keys(perV).length) { setMode('VENDOR'); setPerVendor(perV); } else { setMode('ALL'); setAllPct(all); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const existing = ((await api.listMaster('FUEL_MECHANISM')) as any[]).filter((m) => (m.attrs as any)?.airDefault);
      const keep = new Set<string>();
      if (mode === 'ALL') {
        if (allPct === '') throw new Error('Enter an air fuel %.');
        await api.saveMaster('FUEL_MECHANISM', { code: ALL_CODE, name: 'Air Fuel (all vendors)', attrs: { mode: 'FLAT', percentage: Number(allPct), isDefault: true, airDefault: true, network: '' } });
        keep.add(ALL_CODE);
      } else {
        for (const t of targets) {
          const pct = perVendor[t.code];
          if (pct === undefined || pct === '') continue;
          const code = `${ALL_CODE}_${t.code}`;
          await api.saveMaster('FUEL_MECHANISM', { code, name: `Air Fuel — ${t.name}`, attrs: { mode: 'FLAT', percentage: Number(pct), isDefault: true, airDefault: true, network: t.code } });
          keep.add(code);
        }
        if (!keep.size) throw new Error('Enter at least one network’s air fuel %.');
      }
      // Drop stale air-default entries (e.g. after switching Same-for-all ↔ per-vendor).
      for (const e of existing) if (!keep.has(e.code)) await api.deleteMaster('FUEL_MECHANISM', e.code);
      setMsg('✓ Air fuel defaults saved'); onSaved?.(); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ borderLeft: '4px solid var(--brand)', marginTop: 16 }}>
      <h2 style={{ marginBottom: 4 }}>✈️ Air Fuel Surcharge — default %</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Inherited by air / express / DP rate cards that leave Fuel % blank. Choose one value for all carriers, or vary it per vendor (a vendor-specific value wins over the all-vendors one).
      </p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="muted" style={{ color: 'var(--ok)', fontWeight: 700 }}>{msg}</div>}
      <div className="row" style={{ gap: 8, margin: '10px 0' }}>
        <button className={mode === 'ALL' ? '' : 'secondary'} onClick={() => setMode('ALL')} style={{ padding: '6px 14px' }}>Same for all</button>
        <button className={mode === 'VENDOR' ? '' : 'secondary'} onClick={() => setMode('VENDOR')} style={{ padding: '6px 14px' }}>Variable per vendor</button>
      </div>
      {mode === 'ALL' ? (
        <div style={{ maxWidth: 220 }}>
          <label>Air fuel % (all vendors)</label>
          <input type="number" value={allPct} onChange={(e) => setAllPct(e.target.value)} placeholder="e.g. 25" />
        </div>
      ) : (
        <div className="grid cols-3" style={{ gap: 10 }}>
          {targets.map((t) => (
            <div key={t.code}>
              <label style={{ fontSize: 12 }}>{t.name} <span className="muted">({t.code})</span></label>
              <input type="number" value={perVendor[t.code] ?? ''} onChange={(e) => setPerVendor((p) => ({ ...p, [t.code]: e.target.value }))} placeholder="% (blank = 0)" />
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save air fuel defaults'}</button>
      </div>
    </div>
  );
}
