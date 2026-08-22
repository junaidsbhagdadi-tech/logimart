import { FormEvent, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

type Detail = Awaited<ReturnType<typeof api.lifecycleDetail>>;

// The 6-stage milestone stepper (each maps to one or more status codes).
const STAGES = [
  { label: 'Manifested', icon: '📦', codes: ['MAN'] },
  { label: 'Processing', icon: '🧾', codes: ['PKD', 'ORD'] },
  { label: 'In-transit', icon: '🚚', codes: ['DPD'] },
  { label: 'Reached at DC', icon: '🏬', codes: ['DRD'] },
  { label: 'Out for Delivery', icon: '🛵', codes: ['OFD'] },
  { label: 'Delivered', icon: '🏠', codes: ['DLD', 'RTD'] },
];
const TABS = ['Scans', 'Package Detail', 'Consignee Detail', 'Pickup Detail', 'Return Detail'] as const;

function Field({ label, value, color }: { label: string; value?: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: color || 'var(--text)', marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  );
}

export function TrackDetail() {
  const { awb: awbParam } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const isSuper = user?.role === 'SYS_ADMIN';
  const [awb, setAwb] = useState(awbParam ?? '');
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Scans');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const search = async (val?: string, e?: FormEvent) => {
    e?.preventDefault(); setError(''); setMsg(''); setD(null);
    const q = (val ?? awb).trim().toUpperCase();
    if (!q) return;
    try { setD(await api.lifecycleDetail(q)); nav(`/tracker/${q}`, { replace: true }); }
    catch (err: any) { setError(err.message || 'Not found'); }
  };
  useEffect(() => { if (awbParam) search(awbParam); /* eslint-disable-next-line */ }, []);

  const dateFmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const dtFmt = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const stageIdx = d ? STAGES.findIndex((st) => st.codes.includes(d.currentCode)) : -1;

  const reset = async () => {
    if (!d || !confirm(`Purge all scans for ${d.awb} and reset to MAN?`)) return;
    try { await api.lifecycleReset(d.awb); setMsg('✓ Tracking reset to MAN.'); search(d.awb); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}>🧭 Track Shipment</h1>
        <form onSubmit={(e) => search(undefined, e)} className="row" style={{ gap: 8 }}>
          <input value={awb} onChange={(e) => setAwb(e.target.value.toUpperCase())} placeholder="Enter AWB…" style={{ width: 220 }} />
          <button type="submit">Track</button>
          {d && isSuper && <button type="button" className="secondary" onClick={reset} title="Purge scans & reset to MAN">↺ Reset</button>}
        </form>
      </div>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      {d && (
        <>
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Shipment Details</h2>
            <div className="grid cols-4" style={{ gap: 16, rowGap: 18 }}>
              <Field label="AWB Number" value={d.awb} />
              <Field label="Forwarding No." value={d.forwardingAwb} color="var(--brand)" />
              <Field label="Pay Mode" value={d.payMode} />
              <Field label="Shipper" value={d.shipper} />
              <Field label="Origin" value={d.origin} />
              <Field label="Destination" value={d.destination} />
              <Field label="Current Location" value={d.currentLocation} />
              <Field label="Order Date (Manifested)" value={dateFmt(d.orderDate)} />
              <Field label="Current Status" value={`${d.currentLabel} — ${d.currentCode}`} color="var(--ok, #16a34a)" />
              <Field label="Remarks" value={d.remarks} color="var(--warn)" />
              <Field label="EDD" value={dateFmt(d.edd)} color="var(--brand)" />
              <Field label="Service Type" value={d.serviceType} color="var(--brand)" />
              <Field label="Trip Route" value={d.tripRoute} />
              <Field label="Pickup Rider" value={d.pickupRider} color="var(--brand)" />
              <Field label="Delivery Rider" value={d.deliveryRider} color="var(--brand)" />
              <Field label="Pickup POD" value={d.pickupPod ? <a href={d.pickupPod} target="_blank" rel="noreferrer">🖼 view</a> : '—'} />
              <Field label="Delivery POD" value={d.deliveryPod ? <a href={d.deliveryPod} target="_blank" rel="noreferrer">🖼 view</a> : '—'} />
            </div>
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <a href={`/shipments/${d.awb}/awb-print`} target="_blank" rel="noreferrer"><button className="secondary">🖨 Shipping label</button></a>
              {d.consignee.phone && <a href={`tel:${d.consignee.phone}`}><button>📞 Call Consignee</button></a>}
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 18 }}>Milestone Covered</h2>
            <div className="row" style={{ gap: 0, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 4 }}>
              {STAGES.map((st, i) => {
                const done = stageIdx >= 0 && i <= stageIdx;
                const current = i === stageIdx;
                const bg = current ? 'var(--warn, #f59e0b)' : done ? 'var(--ok, #16a34a)' : 'var(--border)';
                return (
                  <div key={st.label} style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
                    <div style={{ textAlign: 'center', width: 92 }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, margin: '0 auto' }}>{st.icon}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6 }}>{st.label}</div>
                    </div>
                    {i < STAGES.length - 1 && <div style={{ width: 34, height: 3, background: i < stageIdx ? 'var(--ok, #16a34a)' : 'var(--border)', marginTop: 22 }} />}
                  </div>
                );
              })}
            </div>
            {['UDL', 'RTO', 'CAN'].includes(d.currentCode) && <p style={{ color: 'var(--warn)', fontWeight: 600, marginTop: 12, marginBottom: 0 }}>⚠ {d.currentLabel} ({d.currentCode}){d.remarks ? ` — ${d.remarks}` : ''}</p>}
          </div>

          <div className="card">
            <div className="tabbar" style={{ marginBottom: 12 }}>
              {TABS.map((t) => <button key={t} className={'tab' + (t === tab ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>)}
            </div>

            {tab === 'Scans' && (
              <table>
                <thead><tr><th>Date/Time</th><th>Location</th><th>Updated By</th><th>Status</th><th>Reason</th><th>Remarks</th></tr></thead>
                <tbody>
                  {d.scans.map((s, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{dtFmt(s.at)}</td>
                      <td>{s.location ?? '—'}</td>
                      <td>{s.by ?? '—'}</td>
                      <td><strong>{s.code}</strong> — {s.label}</td>
                      <td>{s.reason ?? '—'}</td>
                      <td className="muted">{s.remark ?? '—'}</td>
                    </tr>
                  ))}
                  {d.scans.length === 0 && <tr><td colSpan={6} className="muted">No scans yet.</td></tr>}
                </tbody>
              </table>
            )}

            {tab === 'Package Detail' && (
              <table>
                <thead><tr><th>Child ID</th><th>Box</th><th>Dead kg</th><th>Vol kg</th><th>L×W×H</th><th>Status</th></tr></thead>
                <tbody>
                  {d.pieces.map((p) => (
                    <tr key={p.childId}>
                      <td><strong>{p.childId}</strong></td><td>{p.sequenceNo}</td><td>{p.deadKg}</td><td>{p.volKg}</td>
                      <td>{[p.lengthCm, p.widthCm, p.heightCm].filter(Boolean).join('×') || '—'}</td>
                      <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'Consignee Detail' && (
              <div className="grid cols-2" style={{ gap: 14 }}>
                <Field label="Name" value={d.consignee.name} />
                <Field label="Phone" value={d.consignee.phone} />
                <Field label="City" value={d.consignee.city} />
                <Field label="Address" value={d.consignee.address} />
              </div>
            )}

            {tab === 'Pickup Detail' && (
              <div className="grid cols-2" style={{ gap: 14 }}>
                <Field label="Shipper" value={d.shipper} />
                <Field label="Origin" value={d.origin} />
                <Field label="Pickup Rider" value={d.pickupRider} />
                <Field label="Order Date (Manifested)" value={dateFmt(d.orderDate)} />
              </div>
            )}

            {tab === 'Return Detail' && (
              ['RTO', 'RTD'].includes(d.currentCode)
                ? <div className="grid cols-2" style={{ gap: 14 }}><Field label="Return status" value={`${d.currentLabel} (${d.currentCode})`} color="var(--warn)" /><Field label="Remarks" value={d.remarks} /></div>
                : <p className="muted">Not a return shipment.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
