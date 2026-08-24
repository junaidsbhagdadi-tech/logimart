import { useEffect, useState } from 'react';
import { api } from '../api';
import { TAT_ZONES } from '../lib/rateSheet';

// Vendor-specific zone × zone transit-time (TAT, days) matrix, per mode. Rows = origin, cols = dest.
// Stored as MasterEntry type ZONE_TAT, code `<VENDOR>__<MODE>` (VENDOR = SELF or vendor code),
// attrs.matrix = { orig: { dest: days } }. Booking resolves vendor → SELF → legacy for expected delivery.
type Matrix = Record<string, Record<string, number | string>>;
const MODES = ['SURFACE', 'APEX'] as const;
type Mode = (typeof MODES)[number];
const vcode = (v: any) => String(v.vendorCode || v.name).toUpperCase();
const keyOf = (vendor: string, mode: Mode) => `${vendor}__${mode}`;

export function ZoneTat() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [vendor, setVendor] = useState('SELF');
  const [mode, setMode] = useState<Mode>('SURFACE');
  const [store, setStore] = useState<Record<string, Matrix>>({}); // code -> matrix
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const targets = [{ code: 'SELF', name: 'SELF / Own network' }, ...vendors.map((v) => ({ code: vcode(v), name: v.name }))];

  const load = async () => {
    try {
      const [vs, rows] = await Promise.all([api.listVendors().catch(() => []), api.listMaster('ZONE_TAT').catch(() => [])]);
      setVendors((vs as any[]).filter((v) => v.isActive !== false));
      const next: Record<string, Matrix> = {};
      for (const r of rows as any[]) {
        // Normalise legacy codes (bare SURFACE/APEX) → SELF__MODE.
        const raw = String(r.code).toUpperCase();
        const code = raw === 'SURFACE' || raw === 'APEX' ? `SELF__${raw}` : raw;
        next[code] = (r.attrs?.matrix as Matrix) || {};
      }
      setStore(next);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const cur = store[keyOf(vendor, mode)] || {};
  const setCell = (orig: string, dest: string, v: string) =>
    setStore((s) => { const k = keyOf(vendor, mode); return { ...s, [k]: { ...(s[k] || {}), [orig]: { ...((s[k] || {})[orig] || {}), [dest]: v } } }; });

  const upload = async (f?: File) => {
    if (!f) return; setErr(''); setMsg('');
    try {
      const { parseTatWorkbook } = await import('../lib/rateSheet');
      const parsed = await parseTatWorkbook(f, mode);
      setStore((s) => ({
        ...s,
        ...(parsed.SURFACE ? { [keyOf(vendor, 'SURFACE')]: parsed.SURFACE } : {}),
        ...(parsed.APEX ? { [keyOf(vendor, 'APEX')]: parsed.APEX } : {}),
      }));
      setMsg(`✓ Parsed ${Object.keys(parsed).join(' + ') || 'nothing'} for ${vendor} — review and Save each mode.`);
    } catch (e: any) { setErr('Parse failed: ' + e.message); }
  };

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const clean: Matrix = {};
      for (const o of TAT_ZONES) { clean[o] = {}; for (const dz of TAT_ZONES) { const v = Number(cur?.[o]?.[dz]); if (v > 0) clean[o][dz] = v; } }
      await api.saveMaster('ZONE_TAT', { code: keyOf(vendor, mode), name: `${vendor} ${mode} TAT (days)`, attrs: { vendor, mode, matrix: clean } });
      setMsg(`✓ Saved ${vendor} · ${mode} TAT.`); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card" style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12 }}>Vendor</label>
          <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            {targets.map((t) => <option key={t.code} value={t.code}>{t.name} ({t.code})</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12 }}>Mode</label>
          <div className="row" style={{ gap: 6 }}>
            {MODES.map((m) => <button key={m} className={m === mode ? '' : 'secondary'} style={{ padding: '8px 14px' }} onClick={() => setMode(m)}>{m}</button>)}
          </div>
        </div>
        <label className="secondary" style={{ padding: '9px 14px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
          ⬆ Upload TAT xlsx<input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save ${vendor} · ${mode}`}</button>
        <span className="muted" style={{ fontSize: 12 }}>TAT is per vendor. Upload fills SURFACE + APEX for the selected vendor; Save each mode. Rows = origin, cols = dest.</span>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}><strong>{vendor}</strong> · {mode} — transit days</div>
        <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--bg, #fff)' }}>orig↓ / dest→</th>
              {TAT_ZONES.map((z) => <th key={z} style={{ padding: '4px 6px', textAlign: 'center' }}>{z}</th>)}
            </tr>
          </thead>
          <tbody>
            {TAT_ZONES.map((orig) => (
              <tr key={orig}>
                <td style={{ fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg, #fff)', padding: '2px 6px' }}>{orig}</td>
                {TAT_ZONES.map((dest) => (
                  <td key={dest} style={{ padding: 1 }}>
                    <input type="number" value={cur?.[orig]?.[dest] ?? ''} onChange={(e) => setCell(orig, dest, e.target.value)}
                      style={{ width: 40, padding: '3px 2px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 4, background: orig === dest ? 'var(--bg-soft, #f2f4f7)' : undefined }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
