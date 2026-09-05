import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const REGIONS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTHEAST'];
type Pin = { pincode: string; city: string; state: string; region: string; tier: number; isOda: boolean };
type Hub = { id: string; code: string; name: string; zone: string };
type ServiceArea = { id: string; pincode: string; city: string | null; state: string | null; network: string; mode: string | null; tatDays: number | null; isOda: boolean; isActive: boolean };

export function MasterData() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [p, setP] = useState<Pin>({ pincode: '', city: '', state: '', region: 'SOUTH', tier: 2, isOda: false });
  const [h, setH] = useState<Hub>({ id: '', code: '', name: '', zone: 'SOUTH' });

  // ---- serviceability coverage (SELF network / vendor-wise bulk upload) ----
  const covCols = 'pincode,city,state,mode,tatDays,isOda';
  const [net, setNet] = useState('SELF');
  const [covText, setCovText] = useState('');
  const [covRows, setCovRows] = useState<ServiceArea[]>([]);
  const [covFilter, setCovFilter] = useState('');
  const [networks, setNetworks] = useState<string[]>([]);
  const [vendorNames, setVendorNames] = useState<string[]>([]); // for the Network dropdown
  useEffect(() => { api.listVendors().then((v: any[]) => setVendorNames(v.filter((x) => x.isActive !== false).map((x) => String(x.vendorCode || x.name).toUpperCase()))).catch(() => {}); }, []);
  const [covResult, setCovResult] = useState<{ imported: number; failed: number; errors: { pincode: string; error: string }[] } | null>(null);
  const [covBusy, setCovBusy] = useState(false);

  const load = () => {
    api.listPincodes().then(setPins).catch((e) => setError(e.message));
    api.listHubs().then(setHubs).catch(() => {});
  };
  useEffect(load, []);

  const loadCoverage = () => {
    api.serviceNetworks().then(setNetworks).catch(() => {});
    api.listServiceAreas(covFilter || undefined).then(setCovRows).catch(() => {});
  };
  useEffect(loadCoverage, [covFilter]);

  const toggleSA = async (id: string, patch: { isOda?: boolean; isActive?: boolean }) => {
    try { await api.toggleServiceArea(id, patch); loadCoverage(); } catch { /* keep silent — reload shows state */ }
  };

  const covTemplate = () => {
    const url = URL.createObjectURL(new Blob([covCols + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logimart-serviceable-pincodes-template.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const importCoverage = async () => {
    setError(''); setCovResult(null);
    const rows = parseCsv(covText);
    if (rows.length === 0) { setError(`Paste CSV rows (${covCols}) or upload a file.`); return; }
    setCovBusy(true);
    try {
      const res = await api.bulkServiceAreas(rows, net.trim() || 'SELF');
      setCovResult(res); setCovText(''); loadCoverage();
    } catch (e: any) { setError(e.message); }
    setCovBusy(false);
  };

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
        <h2>📤 Bulk upload serviceable pincodes — SELF network / vendor-wise</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Load coverage for your own <strong>SELF</strong> network or a specific <strong>vendor</strong>. Columns: <code>{covCols}</code>. Same pincode + network is updated; the base directory is kept in sync.
        </p>
        <div className="grid cols-3">
          <div>
            <label>Network</label>
            <select value={net} onChange={(e) => setNet(e.target.value)}>
              <option value="">— select network —</option>
              <option value="SELF">SELF</option>
              {Array.from(new Set([...vendorNames, ...networks.filter((n) => n.toUpperCase() !== 'SELF')])).sort().map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={covTemplate}>⬇ Template</button>
          <label className="secondary" style={{ padding: '10px 16px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
            📎 Upload CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setCovText); }} />
          </label>
        </div>
        <textarea rows={6} value={covText} onChange={(e) => setCovText(e.target.value)} placeholder={covCols + '\n560001,Bengaluru,Karnataka,SURFACE,1,false'} style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11, marginTop: 12 }} />
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted">Uploading into <strong>{net.trim() || 'SELF'}</strong>{covResult && <span style={{ marginLeft: 12, color: 'var(--ok)', fontWeight: 700 }}>✓ {covResult.imported} imported{covResult.failed > 0 ? `, ${covResult.failed} failed` : ''}</span>}</div>
          <button onClick={importCoverage} disabled={covBusy || !covText.trim()}>{covBusy ? 'Uploading…' : 'Upload coverage'}</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Network coverage ({covRows.length})</h2>
          <select value={covFilter} onChange={(e) => setCovFilter(e.target.value)} style={{ width: 220 }}>
            <option value="">All networks</option>
            {networks.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Pincode</th><th>City</th><th>State</th><th>Network</th><th>Mode</th><th>TAT</th><th>EDL/ODA</th><th>Serviceable</th><th>Actions</th></tr></thead>
          <tbody>
            {covRows.slice(0, 300).map((x) => (
              <tr key={x.id} style={x.isActive === false ? { opacity: 0.55 } : undefined}>
                <td><strong>{x.pincode}</strong></td><td>{x.city || '—'}</td><td>{x.state || '—'}</td>
                <td><span className={'badge ' + (x.network === 'SELF' ? 'DELIVERED' : 'AT_HUB')}>{x.network}</span></td>
                <td>{x.mode || '—'}</td><td>{x.tatDays != null ? `${x.tatDays}d` : '—'}</td>
                <td>{x.isOda ? <span className="badge PARTIAL">EDL/ODA</span> : <span className="muted">Regular</span>}</td>
                <td>{x.isActive === false ? <span className="badge CANCELLED">Not serviced</span> : <span className="badge DELIVERED">Yes</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Toggle EDL/ODA ↔ Regular for this vendor" onClick={() => toggleSA(x.id, { isOda: !x.isOda })}>{x.isOda ? '→ Regular' : '→ EDL'}</button>
                  <button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} title="Mark serviceable / not serviced by this vendor" onClick={() => toggleSA(x.id, { isActive: x.isActive === false })}>{x.isActive === false ? '✓ Serviceable' : '✕ Not serviced'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {covRows.length === 0 && <p className="muted">No coverage loaded yet — bulk upload above.</p>}
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

/** Minimal CSV → array of {header: value} rows (first line = header). */
// Quote-aware field split (RFC-4180-ish): commas inside "..." stay in the field.
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; } // escaped ""
      inQ = !inQ; continue;
    }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}
