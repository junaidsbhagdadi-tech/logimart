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
// Milestone codes a manual scan can set (MAN is the booking start).
const SCAN_CODES: [string, string][] = [
  ['PKD', 'Picked'], ['ORD', 'Origin hub received'], ['DPD', 'Departed origin'],
  ['DRD', 'Destination received'], ['OFD', 'Out for delivery'], ['DLD', 'Delivered'],
  ['UDL', 'Undelivered'], ['RTO', 'Return to Origin'], ['RTD', 'Return Delivered'], ['CAN', 'Cancelled'],
];

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
  const isClient = user?.role === 'CLIENT_ADMIN';
  const [awb, setAwb] = useState(awbParam ?? '');
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Scans');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [multiText, setMultiText] = useState('');
  const [multi, setMulti] = useState<any[] | null>(null);
  const [multiBusy, setMultiBusy] = useState(false);
  const trackMulti = async () => {
    const awbs = multiText.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!awbs.length) return;
    setMultiBusy(true); setError('');
    try { setMulti(await api.trackMany(awbs)); } catch (e: any) { setError(e.message); } finally { setMultiBusy(false); }
  };

  // #23b — attach a POD image from the tracker (staff), then refresh the detail.
  const uploadPodImg = (file?: File) => {
    if (!file || !d) return;
    const r = new FileReader();
    r.onload = async () => {
      try { await api.attachPodImage((d as any).awb, String(r.result)); setD(await api.lifecycleDetail((d as any).awb)); setMsg('POD uploaded.'); }
      catch (err: any) { setError(err.message); }
    };
    r.readAsDataURL(file);
  };

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
  // Appointment date+time in 24hr dd/mm/yyyy HH:mm (formatted from stored UTC components → matches what was typed).
  const apptFmt = (s?: string | null) => { if (!s) return '—'; const dt = new Date(s); const p = (n: number) => String(n).padStart(2, '0'); return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`; };

  const stageIdx = d ? STAGES.findIndex((st) => st.codes.includes(d.currentCode)) : -1;

  const reset = async () => {
    if (!d || !confirm(`Purge all scans for ${d.awb} and reset to MAN?`)) return;
    try { await api.lifecycleReset(d.awb); setMsg('✓ Tracking reset to MAN.'); search(d.awb); }
    catch (e: any) { setError(e.message); }
  };

  // Manual scan update — record a milestone straight from the tracker (replaces the sidebar "Update Scans").
  const canScan = !!user && user.role !== 'CLIENT_ADMIN';
  const [scan, setScan] = useState({ code: 'PKD', location: '', remark: '', at: '' });
  const [scanBusy, setScanBusy] = useState(false);
  const doScan = async () => {
    if (!d || !scan.code) return;
    setScanBusy(true); setError(''); setMsg('');
    try {
      const r = await api.lifecycleScan({ awbs: [d.awb], code: scan.code, location: scan.location || undefined, remark: scan.remark || undefined, scanAt: scan.at || undefined });
      if (r.duplicate?.length) setError(`⚠ ${scan.code} is already recorded on ${d.awb} — a scan can't be repeated.`);
      else if (r.locked?.length) setError(`🔒 ${scan.code} is out of sequence / terminal — super-admin only.`);
      else { setMsg(`✓ ${d.awb} updated to ${scan.code}.`); setScan((s) => ({ ...s, remark: '', at: '' })); search(d.awb); }
    } catch (e: any) { setError(e.message); } finally { setScanBusy(false); }
  };

  // Forwarding (vendor hand-off) — CS updates the carrier vendor + forwarding AWB from the tracker.
  const [vendors, setVendors] = useState<any[]>([]);
  useEffect(() => { if (canScan) api.listVendors().then((v) => setVendors(v.filter((x: any) => x.isActive !== false))).catch(() => {}); }, [canScan]);
  const [fwd, setFwd] = useState({ vendor: '', forwardingAwb: '' });
  useEffect(() => { if (d) setFwd({ vendor: (d as any).vendor ?? '', forwardingAwb: d.forwardingAwb ?? '' }); }, [d]);
  const [fwdBusy, setFwdBusy] = useState(false);
  const saveFwd = async () => {
    if (!d) return;
    setFwdBusy(true); setError(''); setMsg('');
    try { const r = await api.setForwarding(d.awb, { vendor: fwd.vendor || undefined, forwardingAwb: fwd.forwardingAwb || undefined }); setMsg(r.message); search(d.awb); }
    catch (e: any) { setError(e.message); } finally { setFwdBusy(false); }
  };

  // Appointment delivery date — updates the shipment + shows in Remarks.
  const [appt, setAppt] = useState({ date: '', note: '' });
  const [apptBusy, setApptBusy] = useState(false);
  const saveAppt = async () => {
    if (!d || !appt.date) return;
    setApptBusy(true); setError(''); setMsg('');
    try { await api.setAppointment(d.awb, { date: appt.date, note: appt.note || undefined }); setMsg(`✓ Appointment set for ${d.awb}.`); search(d.awb); }
    catch (e: any) { setError(e.message); } finally { setApptBusy(false); }
  };

  return (
    <>
      {!d ? (
        // Centered hero search until a shipment is tracked.
        <div style={{ minHeight: '62vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center', padding: '0 16px' }}>
          <div style={{ fontSize: 46, lineHeight: 1 }}>🧭</div>
          <h1 style={{ margin: 0 }}>Track Shipment</h1>
          <p className="muted" style={{ margin: 0 }}>Enter an AWB number to see its live journey.</p>
          <form onSubmit={(e) => search(undefined, e)} className="row" style={{ gap: 10, justifyContent: 'center', width: '100%', maxWidth: 540, marginTop: 4 }}>
            <input autoFocus value={awb} onChange={(e) => setAwb(e.target.value.toUpperCase())} placeholder="Enter AWB…" style={{ flex: 1, maxWidth: 380, padding: '12px 16px', fontSize: 16 }} />
            <button type="submit" style={{ padding: '12px 24px', fontSize: 15 }}>Track</button>
          </form>
          {error && <div className="error" style={{ marginTop: 8, maxWidth: 540, width: '100%' }}>{error}</div>}
          <details style={{ width: '100%', maxWidth: 760, marginTop: 6, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>📋 Track multiple AWBs at once</summary>
            <div style={{ marginTop: 10 }}>
              <textarea value={multiText} onChange={(e) => setMultiText(e.target.value)} placeholder="Paste AWBs — one per line, or comma / space separated" style={{ width: '100%', minHeight: 90, fontFamily: 'monospace', fontSize: 13, padding: 10 }} />
              <button className="secondary" style={{ marginTop: 8 }} disabled={multiBusy} onClick={trackMulti}>{multiBusy ? 'Tracking…' : 'Track all'}</button>
              {multi && (
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table style={{ fontSize: 13, width: '100%' }}>
                    <thead><tr><th>AWB</th><th>Status</th><th>Consignee</th><th>Destination</th><th>Pcs</th><th>EDD</th></tr></thead>
                    <tbody>
                      {multi.map((r, i) => (
                        <tr key={i} onClick={() => r.found && search(r.awb)} style={{ cursor: r.found ? 'pointer' : 'default' }}>
                          <td><strong>{r.awb}</strong></td>
                          <td>{r.found ? <span style={{ fontWeight: 600 }}>{r.currentLabel}</span> : <span className="badge EXCEPTION">not found</span>}</td>
                          <td>{r.consignee || '—'}</td>
                          <td>{r.destination || '—'}</td>
                          <td>{r.found ? `${r.delivered}/${r.pieceCount}` : '—'}</td>
                          <td>{r.expectedDelivery ? new Date(r.expectedDelivery).toLocaleDateString('en-GB') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        </div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h1 style={{ margin: 0 }}>🧭 Track Shipment</h1>
            <form onSubmit={(e) => search(undefined, e)} className="row" style={{ gap: 8 }}>
              <input value={awb} onChange={(e) => setAwb(e.target.value.toUpperCase())} placeholder="Enter AWB…" style={{ width: 220 }} />
              <button type="submit">Track</button>
              {isSuper && <button type="button" className="secondary" onClick={reset} title="Purge scans & reset to MAN">↺ Reset</button>}
            </form>
          </div>
          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        </>
      )}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      {d && (
        <>
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Shipment Details</h2>
            <div className="grid cols-4" style={{ gap: 16, rowGap: 18 }}>
              <Field label="AWB Number" value={d.awb} />
              <Field label="Customer" value={(d as any).customerName} />
              <Field label="Account No." value={(d as any).accountCode} color="var(--brand)" />
              <Field label="Forwarding No." value={d.forwardingAwb} color="var(--brand)" />
              <Field label="Pay Mode" value={d.payMode} />
              <Field label="Shipper" value={d.shipper} />
              <Field label="Origin" value={d.origin} />
              <Field label="Origin Pincode" value={(d as any).originPincode} />
              <Field label="Destination" value={d.destination} />
              <Field label="Destination Pincode" value={(d as any).destPincode} />
              <Field label="Current Location" value={d.currentLocation} />
              <Field label="Order Date (Manifested)" value={dateFmt(d.orderDate)} />
              <Field label="Current Status" value={`${d.currentLabel} — ${d.currentCode}`} color="var(--ok, #16a34a)" />
              <Field label="Remarks" value={d.remarks} color="var(--warn)" />
              {(d as any).customerRemark && <Field label="📣 Customer note" value={(d as any).customerRemark} color="var(--brand)" />}
              <Field label="EDD" value={dateFmt(d.edd)} color="var(--brand)" />
              <Field label="Shipment Value" value={(d as any).shipmentValue != null ? `₹${Number((d as any).shipmentValue).toLocaleString('en-IN')}` : '—'} />
              {(d as any).apptDate && <Field label="Appointment" value={apptFmt((d as any).apptDate)} color="var(--brand)" />}
              {Number((d as any).collectOnDelivery) > 0 && <Field label="💰 Collect on Delivery (FOD)" value={`₹${Number((d as any).collectOnDelivery).toLocaleString('en-IN')}`} color="var(--danger, #c0392b)" />}
              {Number((d as any).dodAmount) > 0 && <Field label="Collect DOD" value={`₹${Number((d as any).dodAmount).toLocaleString('en-IN')}`} color="var(--danger, #c0392b)" />}
              <Field label="Service Type" value={d.serviceType} color="var(--brand)" />
              <Field label="Trip Route" value={d.tripRoute} />
              <Field label="Pickup Rider" value={d.pickupRider} color="var(--brand)" />
              <Field label="Delivery Rider" value={d.deliveryRider} color="var(--brand)" />
              <Field label="Pickup POD" value={d.pickupPod ? <a href={d.pickupPod} target="_blank" rel="noreferrer">🖼 view</a> : '—'} />
              <Field label="Delivery POD" value={d.deliveryPod
                ? <span>🖼 <a href={d.deliveryPod} target="_blank" rel="noreferrer">view</a>{!isClient && <> · <label style={{ cursor: 'pointer', color: 'var(--brand)' }}>replace<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadPodImg(e.target.files?.[0])} /></label></>}</span>
                : (isClient ? '—' : <label style={{ cursor: 'pointer', color: 'var(--brand)' }}>⬆ Upload POD<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadPodImg(e.target.files?.[0])} /></label>)} />
            </div>
            {(d as any).vendorContacts?.length > 0 && (
              <div className="card" style={{ borderLeft: '4px solid var(--brand)', marginTop: 12 }}>
                <h3 style={{ margin: '0 0 6px' }}>🏢 Carrier branch contacts <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>— who to call for this route</span></h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ fontSize: 13 }}>
                    <thead><tr><th>Location</th><th>Contact</th><th>Role</th><th>Phone</th><th>Email</th></tr></thead>
                    <tbody>
                      {(d as any).vendorContacts.map((c: any, i: number) => (
                        <tr key={i}>
                          <td><strong>{c.location}</strong>{c.product ? <span className="muted"> · {c.product}</span> : ''}</td>
                          <td>{c.name}</td><td>{c.role || '—'}</td>
                          <td>{c.phone ? <a href={`tel:${c.phone}`}>📞 {c.phone}</a> : '—'}</td>
                          <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <a href={`/shipments/${d.awb}/awb-print`} target="_blank" rel="noreferrer"><button className="secondary">🖨 Shipping label</button></a>
              {d.consignee.phone && <a href={`tel:${d.consignee.phone}`}><button>📞 Call Consignee</button></a>}
            </div>
          </div>

          {canScan && (
            <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
              <h2 style={{ marginBottom: 4 }}>✍ Update scan (manual)</h2>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Record a milestone for <strong>{d.awb}</strong> directly here. Out-of-sequence / terminal codes are super-admin only.</p>
              <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end' }}>
                <div>
                  <label>Status</label>
                  <select value={scan.code} onChange={(e) => setScan((s) => ({ ...s, code: e.target.value }))}>
                    {SCAN_CODES.map(([c, l]) => <option key={c} value={c}>{c} — {l}</option>)}
                  </select>
                </div>
                <div><label>Scan date &amp; time <span className="muted">(24hr · blank = now)</span></label><input type="datetime-local" value={scan.at} onChange={(e) => setScan((s) => ({ ...s, at: e.target.value }))} /></div>
                <div><label>Location <span className="muted">(optional)</span></label><input value={scan.location} onChange={(e) => setScan((s) => ({ ...s, location: e.target.value }))} placeholder="e.g. Bhiwandi DC" /></div>
                <div><label>Remark <span className="muted">(optional)</span></label><input value={scan.remark} onChange={(e) => setScan((s) => ({ ...s, remark: e.target.value }))} placeholder="reason / note" /></div>
                <div><button onClick={doScan} disabled={scanBusy}>{scanBusy ? 'Updating…' : '＋ Update scan'}</button></div>
              </div>
              <div style={{ borderTop: '1px dashed var(--line, #d7dadf)', marginTop: 14, paddingTop: 12 }}>
                <h2 style={{ marginBottom: 4, fontSize: 15 }}>📅 Appointment delivery</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Set the appointment date — it shows on the tracker Remarks and in the global appointment notification.{(d as any).apptDate ? ` Current: ${apptFmt((d as any).apptDate)}` : ''}</p>
                <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end' }}>
                  <div><label>Appointment date &amp; time <span className="muted">(24hr)</span></label><input type="datetime-local" value={appt.date} onChange={(e) => setAppt((a) => ({ ...a, date: e.target.value }))} /></div>
                  <div><label>Note <span className="muted">(optional)</span></label><input value={appt.note} onChange={(e) => setAppt((a) => ({ ...a, note: e.target.value }))} placeholder="e.g. deliver after 2pm" /></div>
                  <div><button onClick={saveAppt} disabled={apptBusy || !appt.date}>{apptBusy ? 'Saving…' : '📅 Set appointment'}</button></div>
                </div>
              </div>
              <div style={{ borderTop: '1px dashed var(--line, #d7dadf)', marginTop: 14, paddingTop: 12 }}>
                <h2 style={{ marginBottom: 4, fontSize: 15 }}>🔀 Forwarding (vendor hand-off)</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Record which vendor carried this AWB and the forwarding (carrier) AWB number.{(d as any).vendor ? ` Current vendor: ${(d as any).vendor}.` : ''}</p>
                <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end' }}>
                  <div>
                    <label>Forwarded vendor</label>
                    <select value={fwd.vendor} onChange={(e) => setFwd((f) => ({ ...f, vendor: e.target.value }))}>
                      <option value="">— select vendor —</option>
                      {vendors.map((v) => <option key={v.id} value={v.vendorCode || v.name}>{v.vendorCode} — {v.name}</option>)}
                    </select>
                  </div>
                  <div><label>Forwarding number <span className="muted">(carrier AWB)</span></label><input value={fwd.forwardingAwb} onChange={(e) => setFwd((f) => ({ ...f, forwardingAwb: e.target.value }))} placeholder="e.g. 58001396353" /></div>
                  <div><button onClick={saveFwd} disabled={fwdBusy || (!fwd.vendor && !fwd.forwardingAwb)}>{fwdBusy ? 'Saving…' : '🔀 Save forwarding'}</button></div>
                </div>
              </div>
            </div>
          )}

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
              <div className="grid cols-3" style={{ gap: 14 }}>
                <Field label="Name" value={d.consignee.name} />
                <Field label="Contact Person" value={(d.consignee as any).contact} />
                <Field label="Phone / Mobile" value={d.consignee.phone
                  ? <a href={`tel:${d.consignee.phone}`}>{d.consignee.phone}</a> : '—'} color="var(--brand)" />
                <Field label="Address" value={d.consignee.address} />
                <Field label="City" value={d.consignee.city} />
                <Field label="State" value={(d.consignee as any).state} />
                <Field label="Pincode" value={(d.consignee as any).pincode} />
                <Field label="GSTIN" value={(d.consignee as any).gstin} />
              </div>
            )}

            {tab === 'Pickup Detail' && (
              <div className="grid cols-3" style={{ gap: 14 }}>
                <Field label="Shipper" value={(d as any).shipperDetail?.name ?? d.shipper} />
                <Field label="Contact Person" value={(d as any).shipperDetail?.contact} />
                <Field label="Phone / Mobile" value={(d as any).shipperDetail?.mobile || (d as any).shipperDetail?.phone
                  ? <a href={`tel:${(d as any).shipperDetail?.mobile || (d as any).shipperDetail?.phone}`}>{(d as any).shipperDetail?.mobile || (d as any).shipperDetail?.phone}</a> : '—'} color="var(--brand)" />
                <Field label="Address" value={(d as any).shipperDetail?.address} />
                <Field label="City" value={(d as any).shipperDetail?.city || d.origin} />
                <Field label="State" value={(d as any).shipperDetail?.state} />
                <Field label="Pincode" value={(d as any).shipperDetail?.pincode ?? (d as any).originPincode} />
                <Field label="GSTIN" value={(d as any).shipperDetail?.gstin} />
                <Field label="Email" value={(d as any).shipperDetail?.email} />
                <Field label="Pickup Rider" value={d.pickupRider} color="var(--brand)" />
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
