import { useEffect, useState } from 'react';
import { api } from '../api';

const DEFAULT_PREFIXES = ['110', '121', '122', '201'];
const DIRECTIONS = [
  { v: 'INBOUND', label: 'Inbound — delivered into DEL/NCR (destination)' },
  { v: 'OUTBOUND', label: 'Outbound — picked up in DEL/NCR (origin)' },
  { v: 'BOTH', label: 'Both — origin or destination in DEL/NCR' },
];

export function GreenTax() {
  const [direction, setDirection] = useState('INBOUND');
  const [prefixes, setPrefixes] = useState(DEFAULT_PREFIXES.join(', '));
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listMaster('SETTING').then((rows) => {
      const g = rows.find((r) => r.code === 'GREEN_TAX');
      if (g?.attrs) {
        if (g.attrs.direction) setDirection(String(g.attrs.direction).toUpperCase());
        if (Array.isArray(g.attrs.prefixes) && g.attrs.prefixes.length) setPrefixes(g.attrs.prefixes.join(', '));
      }
    }).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true); setMsg(''); setError('');
    const list = prefixes.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    try {
      await api.saveMaster('SETTING', { code: 'GREEN_TAX', name: 'Green Tax (Environmental surcharge)', attrs: { direction, prefixes: list }, active: true });
      setMsg('✓ Green-tax policy saved.');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h1>🌱 Green Tax</h1>
      <p className="muted" style={{ marginTop: -8 }}>The environmental surcharge is charged <strong>only for DEL/NCR shipments</strong> — applies to all products (Apex &amp; Surface). Choose whether it triggers on the pickup side, the delivery side, or both.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Applicability</h2>
        <label>When does green tax apply?</label>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} style={{ maxWidth: 520 }}>
          {DIRECTIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
        </select>

        <div style={{ marginTop: 18 }}>
          <label>DEL/NCR pincode prefixes <span className="muted">(comma-separated — a pincode is DEL/NCR if it starts with any of these)</span></label>
          <textarea value={prefixes} onChange={(e) => setPrefixes(e.target.value)} rows={2} style={{ width: '100%', fontFamily: 'monospace' }} />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Covers Delhi (110), Faridabad (121), Gurgaon/Gurugram (122), Noida &amp; Ghaziabad (201). Add/remove prefixes to match your NCR policy.
          </div>
        </div>

        <button style={{ marginTop: 16 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save policy'}</button>
      </div>

      <div className="card" style={{ background: 'var(--bg-soft, var(--surface-2))', fontSize: 13 }}>
        <strong>Note:</strong> this screen controls <em>where</em> green tax applies. The <em>amount</em> is the <code>ENVIRONMENT</code> charge configured on the rate card (or the Masters default) — set/edit it there. If a shipment isn't DEL/NCR per this policy, no green tax is billed even if the charge is configured.
      </div>
    </>
  );
}
