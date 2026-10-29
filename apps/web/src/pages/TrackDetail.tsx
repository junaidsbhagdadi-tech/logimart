import { FormEvent, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../format';
import { StatusBadge } from '../components/StatusBadge';

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

  // DOD — cheque photo + courier AWB / forwarding date (asked automatically on DOD shipments).
  const [dodForm, setDodForm] = useState({ reference: '', courierAwb: '', forwardedAt: '' });
  const [dodBusy, setDodBusy] = useState(false);
  useEffect(() => {
    if (!d) return;
    const x: any = d;
    setDodForm({ reference: x.dodReference ?? '', courierAwb: x.dodCourierAwb ?? '', forwardedAt: x.dodForwardedAt ? String(x.dodForwardedAt).slice(0, 10) : '' });
  }, [d]);
  const saveDod = async (dataUrl?: string) => {
    if (!d) return;
    setDodBusy(true); setError(''); setMsg('');
    try {
      await api.dodCheque((d as any).awb, { dataUrl, reference: dodForm.reference || undefined, courierAwb: dodForm.courierAwb || undefined, forwardedAt: dodForm.forwardedAt || undefined });
      setD(await api.lifecycleDetail((d as any).awb)); setMsg(dataUrl ? 'Cheque photo uploaded.' : 'DOD cheque details saved.');
    } catch (err: any) { setError(err.message); } finally { setDodBusy(false); }
  };
  const uploadCheque = (file?: File) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => saveDod(String(r.result));
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
  // RTO from the scan form: the carrier's return number + our return AWB (original + "R") → billed + tracked.
  const [rto, setRto] = useState({ forwardingNo: '', vendor: '', returnAwb: '' });
  const [scanBusy, setScanBusy] = useState(false);
  const doScan = async () => {
    if (!d || !scan.code) return;
    setScanBusy(true); setError(''); setMsg('');
    try {
      // RTO with the return carrier number → book the return AWB (original + R) in the same step.
      if (scan.code === 'RTO' && rto.forwardingNo.trim() && !(d as any).rtoAwb) {
        const rr = await api.rtoClose(d.awb, { forwardingNo: rto.forwardingNo.trim(), vendor: (rto.vendor || (d as any).vendorCode || '').trim() || undefined, returnAwb: rto.returnAwb.trim() || undefined });
        setMsg(`✓ ${rr.message}`); setRto({ forwardingNo: '', vendor: '', returnAwb: '' }); search(d.awb);
        return;
      }
      const r = await api.lifecycleScan({ awbs: [d.awb], code: scan.code, location: scan.location || undefined, remark: scan.remark || undefined, scanAt: scan.at || undefined });
      if (r.duplicate?.length) setError(`⚠ ${scan.code} is already recorded on ${d.awb} — a scan can't be repeated.`);
      else if (r.locked?.length) setError(`🔒 ${scan.code} is out of sequence / terminal — super-admin only.`);
      else if (r.needPod?.length) setError(`📷 Upload the delivery POD first (use “replace” on Delivery POD above), then mark Delivered.`);
      else { setMsg(`✓ ${d.awb} updated to ${scan.code}.`); setScan((s) => ({ ...s, remark: '', at: '' })); search(d.awb); }
    } catch (e: any) { setError(e.message); } finally { setScanBusy(false); }
  };

  // Forwarding (vendor hand-off) — CS updates the carrier vendor + forwarding AWB from the tracker.
  const [vendors, setVendors] = useState<any[]>([]);
  useEffect(() => { if (canScan) api.listVendors().then((v) => setVendors(v.filter((x: any) => x.isActive !== false))).catch(() => {}); }, [canScan]);
  const [fwd, setFwd] = useState({ vendor: '', forwardingAwb: '' });
  useEffect(() => { if (d) setFwd({ vendor: (d as any).vendor ?? '', forwardingAwb: d.forwardingAwb ?? '' }); }, [d]);

  // #1 — add-on / expense charges CS logs from the tracker (billed to the customer on the next invoice).
  const [addons, setAddons] = useState<any[]>([]);
  const [addForm, setAddForm] = useState({ amount: '', reason: '', serviceCentre: '', mode: '', toBill: true });
  useEffect(() => { if (d && canScan) api.listAddons(d.awb).then(setAddons).catch(() => setAddons([])); }, [d, canScan]);
  const addAddon = async () => {
    if (!d || !(Number(addForm.amount) > 0) || !addForm.reason.trim()) { setError('Enter an amount and a reason for the charge.'); return; }
    setError(''); setMsg('');
    try { await api.addAddon(d.awb, { ...addForm, amount: Number(addForm.amount) }); setAddForm({ amount: '', reason: '', serviceCentre: '', mode: '', toBill: true }); setMsg('✓ Add-on charge added.'); api.listAddons(d.awb).then(setAddons); }
    catch (e: any) { setError(e.message); }
  };
  const delAddon = async (id: string) => { if (!confirm('Delete this charge?')) return; try { await api.deleteAddon(id); if (d) api.listAddons(d.awb).then(setAddons); } catch (e: any) { setError(e.message); } };
  const [fwdBusy, setFwdBusy] = useState(false);
  const saveFwd = async () => {
    if (!d) return;
    setFwdBusy(true); setError(''); setMsg('');
    try { const r = await api.setForwarding(d.awb, { vendor: fwd.vendor || undefined, forwardingAwb: fwd.forwardingAwb || undefined }); setMsg(r.message); search(d.awb); }
    catch (e: any) { setError(e.message); } finally { setFwdBusy(false); }
  };

  // Appointment delivery date — updates the shipment + shows in Remarks.
  const [appt, setAppt] = useState({ date: '', note: '' });
  // #12 — message to the customer: pops up in their portal until they mark it done.
  const [toCust, setToCust] = useState('');
  const [toCustBusy, setToCustBusy] = useState(false);
  const sendToCust = async () => {
    if (!d || !toCust.trim()) return;
    setToCustBusy(true); setError(''); setMsg('');
    try { await api.recordScan({ awb: d.awb, eventType: 'COMMENT', remark: toCust.trim(), notifyCustomer: true }); setToCust(''); setMsg('✓ Sent — it pops up for the customer until they mark it done.'); search(d.awb); }
    catch (e: any) { setError(e.message); } finally { setToCustBusy(false); }
  };
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
                          <td>{r.expectedDelivery ? fmtDate(r.expectedDelivery) : '—'}</td>
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
              <Field label="Forwarding Vendor" value={(d as any).vendorName ?? (d as any).vendor ?? '—'} color="var(--brand)" />
              <Field label="Forwarding No." value={d.forwardingAwb} color="var(--brand)" />
              {!isClient && <Field label="Weight (booked)" value={(d as any).chargeWeight != null ? `${Number((d as any).actualWeight).toLocaleString('en-IN')} kg actual · ${Number((d as any).chargeWeight).toLocaleString('en-IN')} kg chargeable` : '—'} />}
              <Field label="Pieces" value={(d as any).pieceCount ?? '—'} />
              {(d as any).referenceNo && <Field label="Reference No." value={(d as any).referenceNo} />}
              {(d as any).carrierWaybill && <Field label="Carrier waybill" value={(d as any).carrierWaybill} color="var(--brand)" />}
              {(d as any).carrierStatus && <Field label="Carrier status" value={(d as any).carrierStatus} color="var(--ok, #16a34a)" />}
              {(d as any).pickupStage && <Field label="BlueDart Pickup" value={(d as any).pickupStage === 'PICKED' ? '✓ Picked up by BlueDart' : '🕑 Scheduled with BlueDart — pending collection'} color={(d as any).pickupStage === 'PICKED' ? 'var(--ok, #16a34a)' : 'var(--warn, #d97706)'} />}
              <Field label="Pay Mode" value={d.payMode} />
              <Field label="Shipper" value={d.shipper} />
              <Field label="Origin" value={d.origin} />
              <Field label="Origin Pincode" value={(d as any).originPincode} />
              <Field label="Destination" value={d.destination} />
              {!isClient && <Field label="Destination Pincode" value={(d as any).destPincode} />}
              <Field label="Current Location" value={d.currentLocation} />
              <Field label="Order Date (Manifested)" value={dateFmt(d.orderDate)} />
              <Field label="Current Status" value={`${d.currentLabel} — ${d.currentCode}`} color="var(--ok, #16a34a)" />
              <Field label="Remarks" value={d.remarks} color="var(--warn)" />
              {(d as any).customerRemark && <Field label="📣 Customer note" value={(d as any).customerRemark} color="var(--brand)" />}
              <Field label="EDD" value={dateFmt(d.edd)} color="var(--brand)" />
              {(d as any).isOda && <Field label="⚠ ODA location" value="Outstation delivery area — please allow ~2 extra days beyond the EDD." color="var(--warn, #d97706)" />}
              <Field label="Shipment Value" value={(d as any).shipmentValue != null ? `₹${Number((d as any).shipmentValue).toLocaleString('en-IN')}` : '—'} />
              {(d as any).apptDate && <Field label="Appointment" value={apptFmt((d as any).apptDate)} color="var(--brand)" />}
              {Number((d as any).collectOnDelivery) > 0 && <Field label="💰 Collect on Delivery (FOD)" value={`₹${Number((d as any).collectOnDelivery).toLocaleString('en-IN')}`} color="var(--danger, #c0392b)" />}
              {Number((d as any).dodAmount) > 0 && <Field label="Collect DOD" value={`₹${Number((d as any).dodAmount).toLocaleString('en-IN')}`} color="var(--danger, #c0392b)" />}
              <Field label="Service Type" value={d.serviceType} color="var(--brand)" />
              <Field label="Trip Route" value={d.tripRoute} />
              <Field label="Booked by" value={(d as any).bookedBy || '—'} color="var(--brand)" />
              <Field label="Pickup Rider" value={d.pickupRider} color="var(--brand)" />
              <Field label="Delivery Rider" value={d.deliveryRider} color="var(--brand)" />
              <Field label="Pickup POD" value={d.pickupPod ? <a href={d.pickupPod} target="_blank" rel="noreferrer">🖼 view</a> : '—'} />
              <Field label="Delivery POD" value={d.deliveryPod
                ? <span>🖼 <a href={d.deliveryPod} target="_blank" rel="noreferrer">view</a>{!isClient && <> · <label style={{ cursor: 'pointer', color: 'var(--brand)' }}>replace<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadPodImg(e.target.files?.[0])} /></label></>}</span>
                : d.currentCode === 'DLD'
                  ? <span>✓ e-POD{(d as any).podReceivedBy ? <> · received by <b>{(d as any).podReceivedBy}</b></> : ' · delivered (carrier confirmation)'}{!isClient && <> · <label style={{ cursor: 'pointer', color: 'var(--brand)' }}>upload image<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadPodImg(e.target.files?.[0])} /></label></>}</span>
                  : (isClient ? '—' : <label style={{ cursor: 'pointer', color: 'var(--brand)' }}>⬆ Upload POD<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadPodImg(e.target.files?.[0])} /></label>)} />
            </div>
            {(d as any).isDod && (() => {
              const x: any = d;
              const incomplete = !x.dodChequeUrl || !x.dodCourierAwb || !x.dodForwardedAt;
              return (
                <div className="card" style={{ borderLeft: `4px solid ${incomplete ? 'var(--warn, #d97706)' : 'var(--ok, #16a34a)'}`, marginTop: 12 }}>
                  <h3 style={{ margin: '0 0 4px' }}>💳 DOD cheque {incomplete ? <span className="badge EXCEPTION" style={{ fontSize: 11 }}>details needed</span> : <span className="badge DELIVERED" style={{ fontSize: 11 }}>complete</span>}</h3>
                  {incomplete && !isClient && <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>This is a DOD shipment — upload the cheque photo and record the courier AWB and date it was forwarded under.</div>}
                  <div className="grid cols-4" style={{ gap: 12, alignItems: 'end' }}>
                    <div>
                      <label>Cheque photo</label>
                      <div style={{ fontSize: 13 }}>
                        {x.dodChequeUrl ? <a href={x.dodChequeUrl} target="_blank" rel="noreferrer">🖼 view</a> : <span className="muted">not uploaded</span>}
                        {!isClient && <> · <label style={{ cursor: 'pointer', color: 'var(--brand)' }}>{x.dodChequeUrl ? 'replace' : '⬆ upload'}<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={dodBusy} onChange={(e) => { uploadCheque(e.target.files?.[0]); e.target.value = ''; }} /></label></>}
                      </div>
                    </div>
                    <div><label>Cheque / DD no.</label><input value={dodForm.reference} disabled={isClient} onChange={(e) => setDodForm((f) => ({ ...f, reference: e.target.value }))} /></div>
                    <div><label>Forwarded by courier AWB</label><input value={dodForm.courierAwb} disabled={isClient} onChange={(e) => setDodForm((f) => ({ ...f, courierAwb: e.target.value }))} /></div>
                    <div><label>Forwarding date</label><input type="date" value={dodForm.forwardedAt} disabled={isClient} onChange={(e) => setDodForm((f) => ({ ...f, forwardedAt: e.target.value }))} /></div>
                  </div>
                  {!isClient && <button style={{ marginTop: 10 }} disabled={dodBusy} onClick={() => saveDod()}>{dodBusy ? 'Saving…' : 'Save DOD details'}</button>}
                </div>
              );
            })()}
            {(d as any).vendorContacts?.length > 0 && (
              <div className="card" style={{ borderLeft: '4px solid var(--brand)', marginTop: 12 }}>
                <h3 style={{ margin: '0 0 6px' }}>🏢 Carrier branch contacts <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>— who to call for this route (📍 = current branch)</span></h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ fontSize: 13 }}>
                    <thead><tr><th>Location</th><th>Contact</th><th>Role</th><th>Phone</th><th>Email</th></tr></thead>
                    <tbody>
                      {(d as any).vendorContacts.map((c: any, i: number) => (
                        <tr key={i} style={c.current ? { background: 'var(--surface-2, #fff7ed)', borderLeft: '3px solid var(--warn, #d97706)' } : undefined}>
                          <td>{c.current ? '📍 ' : ''}<strong>{c.location}</strong>{c.product ? <span className="muted"> · {c.product}</span> : ''}{c.current ? <span className="badge PARTIAL" style={{ marginLeft: 6 }}>current branch</span> : ''}</td>
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
              {scan.code === 'RTO' && !(d as any).rtoAwb && (
                <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end', marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--surface-2, #f6f8fa)' }}>
                  <div><label>Return forwarding no <span className="muted">(carrier's return AWB)</span></label><input value={rto.forwardingNo} onChange={(e) => setRto((x) => ({ ...x, forwardingNo: e.target.value }))} placeholder="e.g. 39710944313" /></div>
                  <div><label>Carrier</label><input value={rto.vendor} onChange={(e) => setRto((x) => ({ ...x, vendor: e.target.value.toUpperCase() }))} placeholder={(d as any).vendorCode || 'vendor code'} /></div>
                  <div><label>Return AWB <span className="muted">(billed)</span></label><input value={rto.returnAwb} onChange={(e) => setRto((x) => ({ ...x, returnAwb: e.target.value.toUpperCase() }))} placeholder={`${d.awb}R`} /></div>
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>With a return forwarding no, the return AWB ({d.awb}R) is booked + billed to the customer and tracked on that number. {d.awb} turns Returned when it's delivered back.</p>
                </div>
              )}
              <div style={{ borderTop: '1px dashed var(--line, #d7dadf)', marginTop: 14, paddingTop: 12 }}>
                <h2 style={{ marginBottom: 4, fontSize: 15 }}>💬 Message to customer</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Pops up in the customer's portal until they mark it done.{(d as any).csComment ? ` Last: “${(d as any).csComment}” — ${(d as any).csCommentReadAt ? 'done by customer' : 'waiting for the customer'}.` : ''}</p>
                <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
                  <div style={{ gridColumn: 'span 3' }}><label>Message</label><input value={toCust} onChange={(e) => setToCust(e.target.value)} placeholder="e.g. Consignee not reachable — please share an alternate number" /></div>
                  <div><button onClick={sendToCust} disabled={toCustBusy || !toCust.trim()}>{toCustBusy ? 'Sending…' : '💬 Send to customer'}</button></div>
                </div>
                <h2 style={{ marginBottom: 4, fontSize: 15 }}>📅 Appointment delivery</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Set the appointment date — it shows on the tracker Remarks and in the global appointment notification.{(d as any).apptDate ? ` Current: ${apptFmt((d as any).apptDate)}` : ''}</p>
                <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end' }}>
                  <div><label>Appointment date &amp; time <span className="muted">(24hr)</span></label><input type="datetime-local" value={appt.date} onChange={(e) => setAppt((a) => ({ ...a, date: e.target.value }))} /></div>
                  <div><label>Note <span className="muted">(optional)</span></label><input value={appt.note} onChange={(e) => setAppt((a) => ({ ...a, note: e.target.value }))} placeholder="e.g. deliver after 2pm" /></div>
                  <div><button onClick={saveAppt} disabled={apptBusy || !appt.date}>{apptBusy ? 'Saving…' : '📅 Set appointment'}</button></div>
                </div>
              </div>
              {['DLD', 'RTD'].includes(String((d as any).currentCode)) && !isSuper ? (
                <p className="muted" style={{ borderTop: '1px dashed var(--line, #d7dadf)', marginTop: 14, paddingTop: 12, fontSize: 12.5 }}>🔒 Delivered — this AWB is closed; forwarding and scans can no longer be changed.</p>
              ) : <div style={{ borderTop: '1px dashed var(--line, #d7dadf)', marginTop: 14, paddingTop: 12 }}>
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
              </div>}
              <div style={{ borderTop: '1px dashed var(--line, #d7dadf)', marginTop: 14, paddingTop: 12 }}>
                <h2 style={{ marginBottom: 4, fontSize: 15 }}>➕ Add-on / expense charge</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Log an ad-hoc expense on this AWB (re-pickup, special handling, etc.). Billed to the customer on the next invoice when "Bill to customer" is ticked.</p>
                <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end' }}>
                  <div><label>Amount ₹ *</label><input type="number" value={addForm.amount} onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))} /></div>
                  <div><label>Reason *</label><input value={addForm.reason} onChange={(e) => setAddForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Re-pickup / special handling" /></div>
                  <div><label>Service centre</label><input value={addForm.serviceCentre} onChange={(e) => setAddForm((f) => ({ ...f, serviceCentre: e.target.value }))} placeholder="BOM" /></div>
                  <div><label>Mode (how paid)</label><input value={addForm.mode} onChange={(e) => setAddForm((f) => ({ ...f, mode: e.target.value }))} placeholder="GPAY / CASH" /></div>
                </div>
                <div className="row" style={{ gap: 12, marginTop: 8, alignItems: 'center' }}>
                  <label className="row" style={{ gap: 6, fontSize: 13, margin: 0 }}><input type="checkbox" checked={addForm.toBill} onChange={(e) => setAddForm((f) => ({ ...f, toBill: e.target.checked }))} style={{ width: 'auto' }} /> Bill to customer</label>
                  <button onClick={addAddon} disabled={!(Number(addForm.amount) > 0) || !addForm.reason.trim()}>➕ Add charge</button>
                </div>
                {addons.length > 0 && (
                  <table style={{ marginTop: 10, fontSize: 13 }}>
                    <thead><tr><th>Reason</th><th style={{ textAlign: 'right' }}>Amount</th><th>Bill?</th><th>Svc ctr</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {addons.map((a) => (
                        <tr key={a.id}>
                          <td>{a.reason}</td><td style={{ textAlign: 'right' }}>₹{Number(a.amount).toLocaleString('en-IN')}</td>
                          <td>{a.toBill ? 'Yes' : 'No'}</td><td>{a.serviceCentre || '—'}</td>
                          <td>{a.billedInvoiceId ? <span className="badge DELIVERED">billed</span> : <span className="badge CREATED">pending</span>}</td>
                          <td>{!a.billedInvoiceId && <button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => delAddon(a.id)}>🗑</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
                      <td><StatusBadge code={p.status} /></td>
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
                {(d as any).bdPickupToken && <Field label="BlueDart Pickup Token" value={(d as any).bdPickupToken} color="var(--brand)" />}
                {(d as any).pickupStage && <Field label="BlueDart Pickup Stage" value={(d as any).pickupStage === 'PICKED' ? '✓ Picked up' : '🕑 Scheduled — pending collection'} color={(d as any).pickupStage === 'PICKED' ? 'var(--ok, #16a34a)' : 'var(--warn, #d97706)'} />}
                {(d as any).bdPickupAt && <Field label="Scheduled Pickup Date" value={dateFmt((d as any).bdPickupAt)} />}
              </div>
            )}

            {tab === 'Return Detail' && (
              <RtoPanel d={d as any} canEdit={!isClient} onDone={async () => setD(await api.lifecycleDetail((d as any).awb))} />
            )}
          </div>
        </>
      )}
    </>
  );
}


/** Return Detail tab: status of a return, and (ops) the RTO close-out form — return carrier no + optional own
 *  return AWB → books & bills the return leg and closes this AWB as Returned. */
function RtoPanel({ d, canEdit, onDone }: { d: any; canEdit: boolean; onDone: () => void }) {
  const [form, setForm] = useState({ forwardingNo: '', returnAwb: '', vendor: String(d.vendorCode || '') });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const code = String(d.currentCode || '');
  if (d.rtoOfAwb) return <p>This is the <strong>return leg</strong> of <a href={`/tracker/${d.rtoOfAwb}`}>{d.rtoOfAwb}</a>.</p>;
  if (d.rtoAwb) return (
    <div className="grid cols-2" style={{ gap: 14 }}>
      <Field label="Return status" value={`${d.currentLabel} (${code})`} color="var(--warn)" />
      <Field label="Return AWB" value={<a href={`/tracker/${d.rtoAwb}`}>{d.rtoAwb}</a>} />
      <Field label="Remarks" value={d.remarks} />
    </div>
  );
  const closable = ['RTO', 'UDL'].includes(code);
  const submit = async () => {
    setErr(''); setMsg('');
    if (!form.forwardingNo.trim()) return setErr('Enter the return forwarding (carrier) number.');
    setBusy(true);
    try { const r = await api.rtoClose(d.awb, { forwardingNo: form.forwardingNo.trim(), returnAwb: form.returnAwb.trim() || undefined, vendor: form.vendor.trim() || undefined }); setMsg(r.message); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {['RTO', 'RTD'].includes(code)
        ? <div className="grid cols-2" style={{ gap: 14 }}><Field label="Return status" value={`${d.currentLabel} (${code})`} color="var(--warn)" /><Field label="Remarks" value={d.remarks} /></div>
        : <p className="muted">Not a return shipment yet.</p>}
      {canEdit && closable && (
        <div className="card" style={{ margin: 0, background: 'var(--surface-2, #f6f8fa)' }}>
          <strong>Return to origin</strong>
          <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>Enter the carrier's return number. This books return AWB {d.awb}R for the same customer (billed on their next invoice, tracked on the return number). {d.awb} turns Returned when the return is delivered.</p>
          <div className="grid cols-3" style={{ gap: 10 }}>
            <div><label>Return forwarding no *</label><input value={form.forwardingNo} onChange={(e) => setForm({ ...form, forwardingNo: e.target.value })} placeholder="e.g. 39710944313" /></div>
            <div><label>Carrier</label><input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="vendor code, e.g. BDR" /></div>
            <div><label>Return AWB (ours)</label><input value={form.returnAwb} onChange={(e) => setForm({ ...form, returnAwb: e.target.value })} placeholder={`${d.awb}R`} /></div>
          </div>
          {err && <p style={{ color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{err}</p>}
          {msg && <p style={{ color: 'var(--ok, #16a34a)', fontSize: 13 }}>{msg}</p>}
          <button onClick={submit} disabled={busy} style={{ marginTop: 8 }}>{busy ? 'Saving…' : 'Mark RTO and book return'}</button>
        </div>
      )}
    </div>
  );
}
