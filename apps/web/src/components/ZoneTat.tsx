import { useEffect, useState } from 'react';
import { api } from '../api';
import { TAT_ZONES } from '../lib/rateSheet';

// Zone × zone transit-time (TAT, in days) matrix, one per mode. Rows = origin zone, cols = dest zone.
// Stored as MasterEntry type ZONE_TAT, code = mode (SURFACE / APEX), attrs.matrix = { orig: { dest: days } }.
type Matrix = Record<string, Record<string, number | string>>;
const MODES = ['SURFACE', 'APEX'] as const;
type Mode = (typeof MODES)[number];

export function ZoneTat() {
  const [mode, setMode] = useState<Mode>('SURFACE');
  const [data, setData] = useState<Record<Mode, Matrix>>({ SURFACE: {}, APEX: {} });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const rows = await api.listMaster('ZONE_TAT');
      const next: Record<Mode, Matrix> = { SURFACE: {}, APEX: {} };
      for (const r of rows as any[]) {
        const m = String(r.code).toUpperCase();
        if (m === 'SURFACE' || m === 'APEX') next[m as Mode] = (r.attrs?.matrix as Matrix) || {};
      }
      setData(next);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const setCell = (orig: string, dest: string, v: string) =>
    setData((d) => ({ ...d, [mode]: { ...d[mode], [orig]: { ...(d[mode][orig] || {}), [dest]: v } } }));

  const upload = async (f?: File) => {
    if (!f) return; setErr(''); setMsg('');
    try {
      const { parseTatWorkbook } = await import('../lib/rateSheet');
      const parsed = await parseTatWorkbook(f);
      setData((d) => ({ SURFACE: parsed.SURFACE ?? d.SURFACE, APEX: parsed.APEX ?? d.APEX }));
      setMsg(`✓ Parsed ${Object.keys(parsed).join(' + ') || 'nothing'} — review and Save.`);
    } catch (e: any) { setErr('Parse failed: ' + e.message); }
  };

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      // normalize to numbers
      const clean: Matrix = {};
      for (const o of TAT_ZONES) { clean[o] = {}; for (const dz of TAT_ZONES) { const v = Number(data[mode]?.[o]?.[dz]); if (v > 0) clean[o][dz] = v; } }
      await api.saveMaster('ZONE_TAT', { code: mode, name: `${mode} transit TAT (days)`, attrs: { matrix: clean } });
      setMsg(`✓ Saved ${mode} TAT matrix.`); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <strong>⏱ Transit TAT (days) — origin zone → dest zone</strong>
        <div className="row" style={{ gap: 6 }}>
          {MODES.map((m) => <button key={m} className={m === mode ? '' : 'secondary'} style={{ padding: '6px 14px' }} onClick={() => setMode(m)}>{m}</button>)}
        </div>
        <label className="secondary" style={{ padding: '8px 14px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
          ⬆ Upload TAT xlsx<input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save ${mode}`}</button>
        <span className="muted" style={{ fontSize: 12 }}>One sheet per mode (SURFACE / APEX). Rows = origin, columns = destination.</span>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--bg, #fff)' }}>{mode} ↓orig / dest→</th>
              {TAT_ZONES.map((z) => <th key={z} style={{ padding: '4px 6px', textAlign: 'center' }}>{z}</th>)}
            </tr>
          </thead>
          <tbody>
            {TAT_ZONES.map((orig) => (
              <tr key={orig}>
                <td style={{ fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg, #fff)', padding: '2px 6px' }}>{orig}</td>
                {TAT_ZONES.map((dest) => (
                  <td key={dest} style={{ padding: 1 }}>
                    <input type="number" value={data[mode]?.[orig]?.[dest] ?? ''} onChange={(e) => setCell(orig, dest, e.target.value)}
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
