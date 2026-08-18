import { useEffect, useState } from 'react';
import { api } from '../api';

const EVENTS = [
  { key: 'PICKUP_IN', label: '📥 Pickup In-scan' },
  { key: 'OUT_SCAN', label: '📤 Out-scan' },
  { key: 'MANIFEST_IN', label: '📦 Manifest In-scan' },
  { key: 'UNDELIVERED', label: '↩️ Un-delivery (NDR)' },
  { key: 'MISROUTE', label: '🔀 Miss-route' },
];

export function Scan() {
  const [eventType, setEventType] = useState(EVENTS[0].key);
  const [awb, setAwb] = useState('');
  const [serviceCenter, setServiceCenter] = useState('');
  const [remark, setRemark] = useState('');
  const [recent, setRecent] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = () => { api.listScans(50).then(setRecent).catch(() => {}); };
  useEffect(load, []);

  const submit = async () => {
    setError(''); setMsg('');
    if (!awb.trim()) return;
    try {
      const r = await api.recordScan({ awb: awb.trim().toUpperCase(), eventType, serviceCenter: serviceCenter || undefined, remark: remark || undefined });
      setMsg(`✓ ${EVENTS.find((e) => e.key === eventType)?.label} recorded for ${r.awb}${r.shipmentUpdated ? ' — status updated' : ''}`);
      setAwb(''); load();
    } catch (e: any) { setError(e.message); }
  };

  const def = EVENTS.find((e) => e.key === eventType)!;
  return (
    <>
      <h1>📡 Scan</h1>
      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {EVENTS.map((e) => (
            <button key={e.key} className={e.key === eventType ? '' : 'secondary'} style={{ padding: '8px 14px' }} onClick={() => setEventType(e.key)}>{e.label}</button>
          ))}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}
      <div className="card">
        <h2>{def.label}</h2>
        <div className="grid cols-3">
          <div><label>AWB No. *</label><input value={awb} autoCapitalize="characters" onChange={(e) => setAwb(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="scan / type AWB" /></div>
          <div><label>Service center</label><input value={serviceCenter} onChange={(e) => setServiceCenter(e.target.value)} /></div>
          <div><label>Remark</label><input value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button onClick={submit} disabled={!awb.trim()}>+ Record scan</button></div>
      </div>
      <div className="card">
        <h2>Recent scans ({recent.length})</h2>
        <table>
          <thead><tr><th>AWB</th><th>Event</th><th>Service center</th><th>At</th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id}><td><strong>{r.awb}</strong></td><td><span className="badge CREATED">{r.eventType}</span></td><td>{r.serviceCenter || '—'}</td><td className="muted">{new Date(r.scanAt).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && <p className="muted">No scans yet.</p>}
      </div>
    </>
  );
}
