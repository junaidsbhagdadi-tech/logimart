import { useEffect, useState } from 'react';
import { api } from '../api';

export function Manifests() {
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [awbs, setAwbs] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [hubs, setHubs] = useState<{ id: string; code: string; name: string }[]>([]);
  const [fromHubId, setFromHubId] = useState('');
  const [toHubId, setToHubId] = useState('');

  const load = () => {
    api.listManifests().then(setRows).catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
    api.listMaster('VEHICLE').then(setVehicles).catch(() => {});
    api.listHubs().then((h) => { setHubs(h); if (h[0]) setFromHubId(String(h[0].id)); if (h[1]) setToHubId(String(h[1].id)); }).catch(() => {});
  }, []);

  const create = async () => {
    setError(''); setMsg('');
    if (!fromHubId || !toHubId) { setError('Pick the from and to hub.'); return; }
    try {
      const m = await api.createManifest({ vehicleNo, fromHubId: Number(fromHubId), toHubId: Number(toHubId) });
      setVehicleNo('');
      setMsg(`Created manifest ${m.code}`);
      load();
      open(m.id);
    } catch (e: any) { setError(e.message); }
  };

  const open = async (id: string) => {
    try { setSel(await api.getManifest(id)); } catch (e: any) { setError(e.message); }
  };

  const attach = async () => {
    if (!sel) return;
    const list = awbs.split(/[\s,]+/).filter(Boolean);
    try { await api.attachManifest(sel.id, list); setAwbs(''); open(sel.id); load(); } catch (e: any) { setError(e.message); }
  };

  const seal = async () => {
    if (!sel) return;
    setError(''); setMsg('');
    try { await api.sealManifest(sel.id); setMsg('Sealed ✓'); open(sel.id); load(); }
    catch (e: any) {
      const d = e.message;
      setError(typeof d === 'string' ? d : 'Cannot seal — some boxes not loaded');
    }
  };

  const arrive = async () => {
    if (!sel) return;
    try { await api.arriveManifest(sel.id); open(sel.id); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Manifests / Trips</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Create trip manifest</h2>
        <div className="grid cols-4" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 12 }}>Vehicle</label>
            <input list="lm-vehicles" placeholder="KA01AB1234" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} />
            <datalist id="lm-vehicles">{vehicles.map((v) => <option key={v.code} value={v.code}>{v.attrs?.type ? `${v.code} · ${v.attrs.type}` : v.code}</option>)}</datalist>
          </div>
          <div>
            <label style={{ fontSize: 12 }}>From hub</label>
            <select value={fromHubId} onChange={(e) => setFromHubId(e.target.value)}>
              <option value="">—</option>{hubs.map((h) => <option key={h.id} value={h.id}>{h.code} — {h.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12 }}>To hub</label>
            <select value={toHubId} onChange={(e) => setToHubId(e.target.value)}>
              <option value="">—</option>{hubs.map((h) => <option key={h.id} value={h.id}>{h.code} — {h.name}</option>)}
            </select>
          </div>
          <button disabled={!vehicleNo || !fromHubId || !toHubId} onClick={create}>Create trip</button>
        </div>
        {!vehicles.length && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Tip: add your fleet under <strong>Vehicles</strong> to pick from a list.</p>}
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Vehicle</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.code}</strong></td><td>{m.vehicleNo}</td>
                <td><span className={`badge ${m.status === 'sealed' ? 'IN_TRANSIT' : m.status === 'arrived' ? 'DELIVERED' : 'CREATED'}`}>{m.status}</span></td>
                <td><button className="secondary" onClick={() => open(m.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{sel.code} — {sel.vehicleNo} <span className="badge">{sel.status}</span></h2>
            <div className="row">
              {sel.status === 'open' && <button onClick={seal}>Seal (validate loaded)</button>}
              {sel.status === 'sealed' && <button onClick={arrive}>Mark arrived</button>}
            </div>
          </div>
          {sel.status === 'open' && (
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <input placeholder="AWBs to attach (comma/space separated)" value={awbs} onChange={(e) => setAwbs(e.target.value)} style={{ flex: 1 }} />
              <button className="secondary" disabled={!awbs} onClick={attach}>Attach</button>
            </div>
          )}
          <table>
            <thead><tr><th>AWB</th><th>Boxes</th><th>Status</th></tr></thead>
            <tbody>
              {(sel.shipments || []).map((s: any) => (
                <tr key={s.awb}><td>{s.awb}</td><td>{s.pieceCount}</td><td><span className={`badge ${s.status}`}>{s.status}</span></td></tr>
              ))}
              {(sel.shipments || []).length === 0 && <tr><td colSpan={3} className="muted">No consignments attached.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
