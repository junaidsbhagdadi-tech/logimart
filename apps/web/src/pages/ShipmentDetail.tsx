import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, RateQuote, Shipment } from '../api';
import { useAuth } from '../auth';

export function ShipmentDetail() {
  const { awb } = useParams();
  const { user } = useAuth();
  const canPod = ['DRIVER', 'HUB_MANAGER', 'SYS_ADMIN'].includes(user?.role || '');
  const canAssign = ['HUB_MANAGER', 'SYS_ADMIN'].includes(user?.role || '');
  const canReweigh = ['WAREHOUSE_HANDLER', 'HUB_MANAGER', 'FINANCE_EXEC', 'SYS_ADMIN'].includes(user?.role || '');
  const canCollect = ['DRIVER', 'HUB_MANAGER', 'FINANCE_EXEC', 'SYS_ADMIN'].includes(user?.role || '');
  const canHandover = ['HUB_MANAGER', 'FINANCE_EXEC', 'SYS_ADMIN'].includes(user?.role || '');
  const [s, setS] = useState<Shipment | null>(null);
  const [quote, setQuote] = useState<RateQuote | null>(null);
  const [podFile, setPodFile] = useState<File | null>(null);
  const [reweighMode, setReweighMode] = useState(false);
  const [rw, setRw] = useState<Record<number, string>>({});
  const [rwd, setRwd] = useState<Record<number, { l: string; w: string; h: string }>>({});
  const setDim = (seq: number, k: 'l' | 'w' | 'h', v: string) => setRwd((m) => ({ ...m, [seq]: { ...(m[seq] || { l: '', w: '', h: '' }), [k]: v } }));
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [vendors, setVendors] = useState<any[]>([]);
  const [fwd, setFwd] = useState({ vendor: '', forwardingAwb: '' });
  const [track, setTrack] = useState<{ code: string; label: string; at: string; remark?: string | null }[]>([]);
  const isSysAdmin = user?.role === 'SYS_ADMIN';
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferId, setTransferId] = useState('');
  const [clients, setClients] = useState<any[]>([]);
  useEffect(() => { if (isSysAdmin) api.listClients().then(setClients).catch(() => {}); }, [isSysAdmin]);
  const doTransfer = async () => {
    if (!transferId || !awb) return;
    if (!confirm('Transfer this AWB to the selected customer?')) return;
    try { const r = await api.transferShipment(awb, transferId); setMsg(`✓ Transferred to ${r.transferredTo.legalName} (${r.transferredTo.accountCode})`); setTransferOpen(false); setTransferId(''); load(); }
    catch (e: any) { setError(e.message); }
  };

  const load = () => {
    if (!awb) return;
    api.getShipment(awb).then((sh) => { setS(sh); setFwd({ vendor: sh.vendor || '', forwardingAwb: sh.forwardingAwb || '' }); }).catch((e) => setError(e.message));
    api.lifecycleTrack(awb).then((t) => setTrack(t.timeline || [])).catch(() => {});
  };
  useEffect(load, [awb]);
  useEffect(() => { if (canHandover) api.listVendors().then((v) => setVendors(v.filter((x: any) => x.isActive !== false))).catch(() => {}); }, [canHandover]);

  const forward = async () => {
    setError(''); setMsg('');
    try { const r = await api.setForwarding(awb!, { vendor: fwd.vendor || undefined, forwardingAwb: fwd.forwardingAwb || undefined }); setMsg(r.message); load(); }
    catch (e: any) { setError(e.message); }
  };

  const getQuote = async () => {
    setError('');
    try { setQuote(await api.rateQuote(awb!)); } catch (e: any) { setError(e.message); }
  };

  const generateEway = async () => {
    const declaredValue = Number(prompt('Declared goods value (₹, must be ≥ 50000 for EWB):'));
    if (!declaredValue) return;
    const vehicleNo = prompt('Vehicle number:') || '';
    setError('');
    setMsg('');
    try {
      const res = await api.generateEway(awb!, declaredValue, vehicleNo);
      setMsg(`E-way bill ${res.ewbNo} (${res.mode}) valid to ${new Date(res.validUpto).toLocaleDateString()}`);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const assignRider = async () => {
    const rid = prompt('Rider (driver) user id to assign for delivery:');
    if (!rid) return;
    setError(''); setMsg('');
    try { await api.assignDelivery(awb!, +rid); setMsg(`Delivery assigned to rider #${rid}`); }
    catch (e: any) { setError(e.message); }
  };

  const recordPod = async () => {
    if (!s) return;
    const delivered = s.rollup.delivered;
    const short = delivered < s.rollup.pieceCount;
    if (short && !confirm(`Only ${delivered}/${s.rollup.pieceCount} boxes delivered. Record a SHORT delivery POD?`)) return;
    setError('');
    setMsg('');
    try {
      let stampPhotoUrl: string | undefined;
      if (podFile) {
        const up = await api.uploadPod(podFile);
        stampPhotoUrl = up.url;
      }
      const res = await api.recordPod(
        awb!,
        { gpsLat: 17.385, gpsLng: 78.486, piecesDelivered: delivered, stampPhotoUrl },
        short,
      );
      setMsg(`POD recorded${res.isShort ? ' (SHORT)' : ''} — ${res.pod.piecesDelivered}/${res.expected} boxes${stampPhotoUrl ? ' with photo' : ''}.`);
      setPodFile(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const collectDodAction = async () => {
    const reference = prompt('Cheque / DD number collected from the consignee:');
    if (!reference) return;
    const bankName = prompt('Bank name (optional):') || undefined;
    setError(''); setMsg('');
    try { const r = await api.collectDod(awb!, { reference, bankName }); setMsg(r.message); load(); }
    catch (e: any) { setError(e.message); }
  };

  const handoverDodAction = async () => {
    if (!confirm('Confirm the DOD draft has been handed over to the consignor?')) return;
    setError(''); setMsg('');
    try { const r = await api.handoverDod(awb!); setMsg(r.message); load(); }
    catch (e: any) { setError(e.message); }
  };

  const collectFreightAction = async () => {
    const amt = Number(prompt('Freight amount collected from the consignee (₹):', s?.freightToCollect ?? ''));
    if (!amt) return;
    setError(''); setMsg('');
    try { const r = await api.collectFreight(awb!, amt); setMsg(r.message); load(); }
    catch (e: any) { setError(e.message); }
  };

  const addComment = async () => {
    const text = prompt('Progress comment / remark for this shipment:');
    if (!text) return;
    setError(''); setMsg('');
    try { await api.recordScan({ awb: awb!, eventType: 'COMMENT', remark: text }); setMsg('💬 Comment added to tracking.'); }
    catch (e: any) { setError(e.message); }
  };

  const handoffBd = async () => {
    if (!confirm('Hand this shipment off to BlueDart (generate waybill)?')) return;
    setError(''); setMsg('');
    try { const r = await api.bdHandoff(awb!); setMsg(r.bdWaybill ? `📦 Handed to BlueDart — waybill ${r.bdWaybill}` : 'Hand-off sent (no waybill returned).'); load(); }
    catch (e: any) { setError(e.message); }
  };
  const trackBd = async () => {
    setError(''); setMsg('');
    try { const r = await api.bdSync(awb!); setMsg(r.bdStatus ? `🔎 BlueDart status: ${r.bdStatus}` : 'BlueDart tracking pulled.'); load(); }
    catch (e: any) { setError(e.message); }
  };

  const submitReweigh = async () => {
    if (!s) return;
    const lines = s.pieces
      .filter((p) => (rw[p.sequenceNo] && +rw[p.sequenceNo] > 0) || rwd[p.sequenceNo])
      .map((p: any) => ({
        sequenceNo: p.sequenceNo,
        actualKg: rw[p.sequenceNo] && +rw[p.sequenceNo] > 0 ? +rw[p.sequenceNo] : +p.deadKg,
        lengthCm: rwd[p.sequenceNo]?.l ? +rwd[p.sequenceNo].l : (p.lengthCm ? +p.lengthCm : undefined),
        widthCm: rwd[p.sequenceNo]?.w ? +rwd[p.sequenceNo].w : (p.widthCm ? +p.widthCm : undefined),
        heightCm: rwd[p.sequenceNo]?.h ? +rwd[p.sequenceNo].h : (p.heightCm ? +p.heightCm : undefined),
      }));
    if (lines.length === 0) { setError('Enter at least one re-weighed box weight or dimension.'); return; }
    setError(''); setMsg('');
    try {
      const res = await api.reweigh(awb!, lines);
      if (!res.billable) {
        setMsg(`Re-weigh saved: booked ${res.bookedChargeableKg}kg → actual ${res.actualChargeableKg}kg. No per-kg rate card, so no freight delta.`);
      } else if (res.debitNote) {
        setMsg(`Re-weigh: ${res.bookedChargeableKg}kg → ${res.actualChargeableKg}kg. Debit note ${res.debitNote.noteNo} for ₹${res.debitNote.total} raised.`);
      } else {
        setMsg(`Re-weigh saved: ${res.bookedChargeableKg}kg → ${res.actualChargeableKg}kg. Freight delta ₹${res.freightDelta} — no note raised.`);
      }
      setReweighMode(false); setRw({}); setRwd({});
      load();
    } catch (e: any) { setError(e.message); }
  };

  if (error && !s) return <div className="error">{error}</div>;
  if (!s) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{s.awb}</h1>
        <div className="row">
          <button className="secondary" onClick={load}>↻ Refresh</button>
          <button className="secondary" onClick={getQuote}>₹ Rate quote</button>
          <button className="secondary" onClick={generateEway}>🛣 E-way bill</button>
          {canAssign && <button className="secondary" onClick={assignRider}>🧑‍✈️ Assign rider</button>}
          {canPod && (
            <label className="secondary" style={{ padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              {podFile ? `📷 ${podFile.name.slice(0, 14)}…` : '📷 POD photo'}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => setPodFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {canPod && <button onClick={recordPod}>✍ Record POD</button>}
          {canPod && <button className="secondary" onClick={addComment}>💬 Comment</button>}
          {canAssign && <button className="secondary" onClick={handoffBd}>📦 Hand to BlueDart</button>}
          {canAssign && s.bdWaybill && <button className="secondary" onClick={trackBd}>🔎 BlueDart track</button>}
          {canReweigh && <button className="secondary" onClick={() => { setReweighMode((v) => !v); setMsg(''); }}>⚖ {reweighMode ? 'Cancel re-weigh' : 'Re-weigh'}</button>}
          {isSysAdmin && <button className="secondary" onClick={() => { setTransferOpen((v) => !v); setMsg(''); setError(''); }} title="Wrong-entry transfer to another customer">🔄 Transfer</button>}
          <Link to={`/shipments/${s.awb}/labels`}><button>🏷 Print labels</button></Link>
          <a href={`/shipments/${s.awb}/awb-print`} target="_blank" rel="noreferrer"><button>🖨 Print AWB</button></a>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      {transferOpen && isSysAdmin && (
        <div className="card" style={{ borderLeft: '4px solid var(--warn)' }}>
          <h2 style={{ marginBottom: 4 }}>🔄 Wrong-entry transfer</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Reassign this AWB to the correct customer. Blocked if it's already invoiced (cancel/rebill the invoice first).</p>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={transferId} onChange={(e) => setTransferId(e.target.value)} style={{ minWidth: 320 }}>
              <option value="">— select correct customer —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
            </select>
            <button disabled={!transferId} onClick={doTransfer}>Transfer AWB</button>
            <button className="secondary" onClick={() => setTransferOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {canHandover && (
        <div className="card">
          <h2>🚚 Forward to vendor</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>Record which vendor carried this AWB and the forwarding (carrier) AWB reference. BlueDart auto-fetches once integrated.</p>
          <div className="grid cols-3" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label>Vendor</label>
              <select value={fwd.vendor} onChange={(e) => setFwd((f) => ({ ...f, vendor: e.target.value }))}>
                <option value="">— select —</option>
                {vendors.map((v) => <option key={v.id} value={v.vendorCode || v.name}>{v.vendorCode} — {v.name}</option>)}
              </select>
            </div>
            <div><label>Forwarding AWB <span className="muted">(vendor's carrier AWB)</span></label><input value={fwd.forwardingAwb} onChange={(e) => setFwd((f) => ({ ...f, forwardingAwb: e.target.value }))} placeholder="e.g. 58001396353" /></div>
            <div><button onClick={forward}>Save hand-off</button></div>
          </div>
          {(s.vendor || s.forwardingAwb) && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Current: {s.vendor || '—'}{s.forwardingAwb ? ` · fwd AWB ${s.forwardingAwb}` : ''}{s.forwardingAt ? ` · ${new Date(s.forwardingAt).toLocaleString('en-IN')}` : ''}</div>}
        </div>
      )}

      {quote && (
        <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
          <strong>Rate quote</strong> — {quote.chargeableKg} kg chargeable{quote.isOda ? ' · ODA' : ''}
          <table style={{ marginTop: 8 }}>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.head}><td>{l.head}</td><td style={{ textAlign: 'right' }}>₹{l.amount.toFixed(2)}</td></tr>
              ))}
              <tr><td><strong>Subtotal</strong></td><td style={{ textAlign: 'right' }}><strong>₹{quote.subtotal.toFixed(2)}</strong></td></tr>
              <tr><td>GST 18%</td><td style={{ textAlign: 'right' }}>₹{quote.gst.toFixed(2)}</td></tr>
              <tr><td><strong>Grand total</strong></td><td style={{ textAlign: 'right' }}><strong>₹{quote.grandTotal.toFixed(2)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="grid cols-3">
          <div><label>Status</label><span className={`badge ${s.status}`}>{s.status}</span></div>
          <div><label>Service</label>{s.serviceMode}</div>
          <div><label>Route</label>{s.originZone} → {s.destZone}</div>
          {s.expectedDelivery && <div><label>Expected delivery</label>{new Date(s.expectedDelivery).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} <span className="muted" style={{ fontSize: 11 }}>(booking + TAT)</span></div>}
          <div><label>Boxes delivered</label>{s.rollup.delivered} / {s.rollup.pieceCount} {s.rollup.isShort && <span className="badge PARTIAL">SHORT</span>}</div>
          <div><label>Total dead</label>{s.totalDeadKg} kg</div>
          <div><label>Total volumetric</label>{s.totalVolKg} kg</div>
          <div><label>LR / GC No.</label>{s.lrNumber ?? '—'}</div>
          <div><label>E-way bill</label>{s.ewbNo ?? '—'}</div>
          {s.product && <div><label>Product</label>{s.product}{s.docType ? ` · ${s.docType}` : ''}</div>}
          {s.bdWaybill && <div><label>BlueDart AWB</label>{s.bdWaybill}{s.bdStatus ? ` · ${s.bdStatus}` : ''}</div>}
          {s.chargeWeight && <div><label>Charge weight</label>{s.chargeWeight} kg</div>}
          <div>
            <label>Payment</label>
            <span className={`badge ${s.paymentTerm === 'TO_PAY' ? 'TO_PAY' : 'PAID'}`}>{s.paymentTerm === 'TO_PAY' ? 'TO-PAY' : 'PREPAID'}</span>
            {s.isDod && <span className="badge DOD" style={{ marginLeft: 6 }}>DOD</span>}
          </div>
          {(s.ftlVehicleType || s.vehicleNo) && <div><label>FTL vehicle</label>{[s.ftlVehicleType, s.vehicleNo].filter(Boolean).join(' · ')}</div>}
          {s.departureAt && <div><label>Departure</label>{new Date(s.departureAt).toLocaleString()}</div>}
          {s.arrivalAt && <div><label>Arrival</label>{new Date(s.arrivalAt).toLocaleString()}</div>}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 10 }}>🧭 Tracking timeline</h2>
        {track.length === 0 ? <p className="muted">No scans recorded yet.</p> : (
          <div style={{ position: 'relative', paddingLeft: 18 }}>
            {track.map((t, i) => (
              <div key={i} style={{ position: 'relative', paddingBottom: i === track.length - 1 ? 0 : 16 }}>
                <span style={{ position: 'absolute', left: -18, top: 3, width: 10, height: 10, borderRadius: '50%', background: i === track.length - 1 ? 'var(--brand)' : 'var(--ok, #16a34a)' }} />
                {i !== track.length - 1 && <span style={{ position: 'absolute', left: -14, top: 13, bottom: 0, width: 2, background: 'var(--border)' }} />}
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t.label} <span className="muted" style={{ fontWeight: 400 }}>({t.code})</span></div>
                <div className="muted" style={{ fontSize: 12 }}>{new Date(t.at).toLocaleString('en-IN')}{t.remark ? ` · ${t.remark}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(s.paymentTerm === 'TO_PAY' || s.isDod) && (
        <div className="card" style={{ borderLeft: s.isDod && !s.dodCollectedAt ? '4px solid var(--warn)' : '4px solid var(--brand)' }}>
          <h2>💳 Payment &amp; collection</h2>
          <div className="grid cols-3">
            {s.paymentTerm === 'TO_PAY' && (
              <>
                <div><label>Freight to collect</label>₹{s.freightToCollect ?? '—'}</div>
                <div>
                  <label>Freight collected</label>
                  {s.freightCollectedAt
                    ? <>₹{s.freightCollected} · {new Date(s.freightCollectedAt).toLocaleString()}</>
                    : <span className="badge PARTIAL">PENDING</span>}
                </div>
              </>
            )}
            {s.isDod && (
              <>
                <div><label>DOD instrument</label>{s.dodInstrument === 'DD' ? 'Demand Draft' : 'Cheque'} · ₹{s.dodAmount ?? '—'}</div>
                <div>
                  <label>Draft collected</label>
                  {s.dodCollectedAt
                    ? <>✅ {s.dodReference}{s.dodBankName ? ` · ${s.dodBankName}` : ''}</>
                    : <span className="badge PARTIAL">NOT COLLECTED</span>}
                </div>
                <div>
                  <label>Handed to consignor</label>
                  {s.dodHandedOverAt ? <>✅ {new Date(s.dodHandedOverAt).toLocaleString()}</> : <span className="muted">pending</span>}
                </div>
              </>
            )}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            {s.isDod && !s.dodCollectedAt && canCollect && (
              <button onClick={collectDodAction}>💷 Collect {s.dodInstrument === 'DD' ? 'DD' : 'cheque'}</button>
            )}
            {s.isDod && s.dodCollectedAt && !s.dodHandedOverAt && canHandover && (
              <button className="secondary" onClick={handoverDodAction}>📤 Hand over draft</button>
            )}
            {s.paymentTerm === 'TO_PAY' && !s.freightCollectedAt && canCollect && (
              <button onClick={collectFreightAction}>💰 Collect freight</button>
            )}
          </div>
          {s.isDod && !s.dodCollectedAt && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>🔒 POD is blocked until the draft is collected.</p>
          )}
        </div>
      )}

      {s.charges && s.charges.length > 0 && (
        <div className="card">
          <h2>🧾 Charges</h2>
          <table>
            <thead><tr><th>Code</th><th>Charge</th><th style={{ textAlign: 'right' }}>Amount ₹</th></tr></thead>
            <tbody>
              {s.charges.map((c) => (
                <tr key={c.code}><td><strong>{c.code}</strong></td><td>{c.name}</td><td style={{ textAlign: 'right' }}>{Number(c.amount).toFixed(2)}</td></tr>
              ))}
              <tr><td colSpan={2}><strong>Total charges</strong></td><td style={{ textAlign: 'right' }}><strong>₹{s.charges.reduce((t, c) => t + Number(c.amount), 0).toFixed(2)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {s.pods && s.pods.length > 0 && (
        <div className="card">
          <h2>Proof of Delivery</h2>
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>
                Delivered {new Date(s.pods[0].deliveredAt).toLocaleString()} · {s.pods[0].piecesDelivered} boxes
                {s.pods[0].isShort && <span className="badge PARTIAL" style={{ marginLeft: 6 }}>SHORT</span>}
              </div>
            </div>
            {s.pods[0].stampPhotoUrl && (
              <a href={s.pods[0].stampPhotoUrl} target="_blank" rel="noreferrer">
                <img src={s.pods[0].stampPhotoUrl} alt="POD" style={{ height: 140, borderRadius: 10, border: '1px solid var(--border)' }} />
              </a>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Pieces</h2>
          {reweighMode && <button onClick={submitReweigh}>Submit re-weigh →</button>}
        </div>
        {reweighMode && <p className="muted" style={{ fontSize: 13 }}>Enter the actual dead weight and/or corrected dimensions caught at the hub. A debit note is raised for any freight increase (per-kg billing).</p>}
        <table>
          <thead>
            <tr><th>Child ID</th><th>Box</th><th>Dead kg</th><th>Vol kg</th>{reweighMode && <><th>Actual kg</th><th>L cm</th><th>W cm</th><th>H cm</th></>}<th>Status</th></tr>
          </thead>
          <tbody>
            {s.pieces.map((p) => (
              <tr key={p.childId}>
                <td><strong>{p.childId}</strong></td>
                <td>{p.sequenceNo} / {s.pieceCount}</td>
                <td>{p.deadKg}</td>
                <td>{p.volKg}</td>
                {reweighMode && (
                  <>
                    <td><input type="number" step="0.001" style={{ width: 80 }} placeholder={String(p.deadKg)}
                      value={rw[p.sequenceNo] ?? ''} onChange={(e) => setRw((m) => ({ ...m, [p.sequenceNo]: e.target.value }))} /></td>
                    <td><input type="number" style={{ width: 60 }} placeholder={String((p as any).lengthCm ?? '')} value={rwd[p.sequenceNo]?.l ?? ''} onChange={(e) => setDim(p.sequenceNo, 'l', e.target.value)} /></td>
                    <td><input type="number" style={{ width: 60 }} placeholder={String((p as any).widthCm ?? '')} value={rwd[p.sequenceNo]?.w ?? ''} onChange={(e) => setDim(p.sequenceNo, 'w', e.target.value)} /></td>
                    <td><input type="number" style={{ width: 60 }} placeholder={String((p as any).heightCm ?? '')} value={rwd[p.sequenceNo]?.h ?? ''} onChange={(e) => setDim(p.sequenceNo, 'h', e.target.value)} /></td>
                  </>
                )}
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
