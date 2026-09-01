import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const inr = (n: any) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const compact = (n: any) => { const v = Number(n ?? 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : inr(v); };
const dd = (s: any) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const STATUS_CLS: Record<string, string> = { DLD: 'DELIVERED', OFD: 'CREATED', PKD: 'CREATED', MAN: 'CREATED', ORD: 'AT_HUB', DPD: 'AT_HUB', DRD: 'AT_HUB', RTO: 'PARTIAL', RTD: 'PARTIAL', CAN: 'CANCELLED', UDL: 'CANCELLED' };
const INV_CLS: Record<string, string> = { PAID: 'DELIVERED', 'PART-PAID': 'PARTIAL', OVERDUE: 'CANCELLED', OPEN: 'CREATED' };

export function ClientPortal() {
  const { user } = useAuth();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => { api.portalOverview().then(setD).catch((e) => setError(e.message)); }, []);

  const [appt, setAppt] = useState<{ awb: string; date: string; remark: string } | null>(null);
  const [msg, setMsg] = useState('');
  const reload = () => api.portalOverview().then(setD).catch(() => {});
  const saveAppt = async () => {
    if (!appt) return;
    try { await api.portalAppointment(appt.awb, { date: appt.date || undefined, remark: appt.remark || undefined }); setMsg(`✓ Appointment updated for ${appt.awb}. Our CS team has been notified.`); setAppt(null); reload(); }
    catch (e: any) { setError(e.message); }
  };
  const addRemark = async (awb: string) => {
    const r = window.prompt(`Leave a remark for our CS team about ${awb}\n(e.g. a contact number, delivery instruction, or a note for tomorrow's appointment):`);
    if (r == null || !r.trim()) return;
    try { await api.portalRemark(awb, r.trim()); setMsg(`✓ Remark sent to our CS team for ${awb}.`); reload(); }
    catch (e: any) { setError(e.message); }
  };

  // Rate check (only if enabled for this account)
  const [products, setProducts] = useState<any[]>([]);
  const [est, setEst] = useState({ product: '', originPincode: '', destPincode: '', deadKg: '', pcs: '1', declaredValue: '' });
  const [estResult, setEstResult] = useState<any>(null);
  useEffect(() => { if (d?.client?.canCheckRates) api.listMaster('PRODUCT').then(setProducts).catch(() => {}); }, [d?.client?.canCheckRates]);
  const runEstimate = async () => {
    setError(''); setEstResult(null);
    if (!est.product || !est.destPincode) { setError('Pick a product and enter the destination pincode.'); return; }
    try { setEstResult(await api.portalRateEstimate({ product: est.product, originPincode: est.originPincode || undefined, destPincode: est.destPincode, deadKg: Number(est.deadKg) || 0, pcs: Number(est.pcs) || 1, declaredValue: Number(est.declaredValue) || 0 })); }
    catch (e: any) { setError(e.message); }
  };

  const exportShipments = async () => {
    try {
      const rows = await api.awbList(2000);
      const head = ['AWB', 'Booked', 'Destination', 'Status', 'Pieces'];
      const body = rows.map((r: any) => [r.awb, r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB') : '', r.route ?? r.destZone ?? '', r.status ?? r.statusCode ?? '', r.pieceCount ?? '']);
      const csv = [head, ...body].map((r) => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `my-shipments-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); }
  };

  if (error) return <div className="error" style={{ margin: 20 }}>{error}</div>;
  if (!d) return <p className="muted" style={{ margin: 20 }}>Loading your dashboard…</p>;

  const k = d.kpis, cr = d.credit;
  const maxTrend = Math.max(1, ...d.trend.map((t: any) => t.count));

  return (
    <>
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}
      {appt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setAppt(null)}>
          <div className="card" style={{ maxWidth: 420, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>📅 Appointment delivery — {appt.awb}</h2>
            <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>Pick a date &amp; time you'd like it delivered. Add a remark for our CS team (e.g. "call before delivery", or a note for a next‑day slot).</p>
            <div><label>Preferred date &amp; time</label><input type="datetime-local" value={appt.date} onChange={(e) => setAppt({ ...appt, date: e.target.value })} /></div>
            <div style={{ marginTop: 8 }}><label>Remark for CS <span className="muted">(optional)</span></label><input value={appt.remark} onChange={(e) => setAppt({ ...appt, remark: e.target.value })} placeholder="e.g. Please call 98xxxxxxx before delivery" /></div>
            <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => setAppt(null)}>Cancel</button>
              <button onClick={saveAppt}>Send to CS</button>
            </div>
          </div>
        </div>
      )}
      {d.client?.canCheckRates && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>💹 Check rates — estimate a shipment cost</summary>
          <div className="grid cols-4" style={{ gap: 10, marginTop: 12 }}>
            <div><label>Product</label><select value={est.product} onChange={(e) => setEst({ ...est, product: e.target.value })}><option value="">— select —</option>{products.map((p: any) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select></div>
            <div><label>Origin pincode <span className="muted">(opt)</span></label><input value={est.originPincode} maxLength={6} onChange={(e) => setEst({ ...est, originPincode: e.target.value })} /></div>
            <div><label>Destination pincode *</label><input value={est.destPincode} maxLength={6} onChange={(e) => setEst({ ...est, destPincode: e.target.value })} /></div>
            <div><label>Weight (kg)</label><input type="number" value={est.deadKg} onChange={(e) => setEst({ ...est, deadKg: e.target.value })} /></div>
            <div><label>No. of boxes</label><input type="number" value={est.pcs} onChange={(e) => setEst({ ...est, pcs: e.target.value })} /></div>
            <div><label>Invoice value ₹ <span className="muted">(for FOV)</span></label><input type="number" value={est.declaredValue} onChange={(e) => setEst({ ...est, declaredValue: e.target.value })} /></div>
          </div>
          <button style={{ marginTop: 10 }} onClick={runEstimate} disabled={!est.product || !est.destPincode}>Estimate cost</button>
          {estResult && (estResult.ok
            ? <div className="card" style={{ marginTop: 10, borderLeft: '4px solid var(--ok, #16a34a)' }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Estimated total: ₹{Number(estResult.total).toLocaleString('en-IN')}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Freight + charges ₹{Number(estResult.subtotal).toLocaleString('en-IN')} + GST ₹{Number(estResult.gst).toLocaleString('en-IN')} · chargeable {estResult.chargeableKg} kg{estResult.isOda ? ' · ODA location' : ''}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Indicative estimate — final billing may vary with actual weight, ODA and applicable charges.</div>
              </div>
            : <div className="muted" style={{ marginTop: 10 }}>{estResult.message || 'No rate available.'}</div>)}
        </details>
      )}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0 }}>👋 Welcome, {user?.fullName?.split(' ')[0] ?? d.client.legalName}</h1>
          <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{d.client.legalName} · {d.client.accountCode}{d.client.gstin ? ` · GSTIN ${d.client.gstin}` : ''}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/tracker"><button className="secondary">🧭 Track</button></Link>
          <Link to="/pickups"><button className="secondary">📦 Schedule Pickup</button></Link>
          <Link to="/create"><button>➕ Book Shipment</button></Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid cols-4" style={{ gap: 12 }}>
        <div className="card"><label>Total shipments</label><div style={{ fontSize: 24, fontWeight: 800 }}>{k.total.toLocaleString('en-IN')}</div></div>
        <div className="card"><label>Delivered</label><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ok)' }}>{k.delivered.toLocaleString('en-IN')}</div><div className="muted" style={{ fontSize: 11 }}>{k.deliveredPct}% of total</div></div>
        <div className="card"><label>In transit</label><div style={{ fontSize: 24, fontWeight: 800 }}>{k.inTransit.toLocaleString('en-IN')}</div></div>
        <div className="card"><label>On-time delivery</label><div style={{ fontSize: 24, fontWeight: 800, color: k.onTimePct != null && k.onTimePct < 85 ? 'var(--warn)' : 'var(--ok)' }}>{k.onTimePct != null ? `${k.onTimePct}%` : '—'}</div><div className="muted" style={{ fontSize: 11 }}>{k.rto} RTO</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr', gap: 12, alignItems: 'start' }}>
        {/* LEFT: trend + recent shipments */}
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>📈 Shipping trend</h2><span className="muted">last 6 months</span></div>
            <div className="row" style={{ alignItems: 'flex-end', gap: 14, height: 130, marginTop: 14, paddingLeft: 4 }}>
              {d.trend.map((t: any, i: number) => (
                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t.count}</div>
                  <div style={{ height: `${(t.count / maxTrend) * 90}px`, minHeight: 2, background: 'var(--brand)', borderRadius: '6px 6px 0 0', margin: '4px 6px 0' }} />
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t.month}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Recent shipments</h2>
              <div className="row" style={{ gap: 8 }}>
                <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportShipments}>⬇ Export CSV</button>
                <Link to="/awb-list" className="muted" style={{ fontSize: 12 }}>view all →</Link>
              </div>
            </div>
            <div style={{ overflowX: 'auto', marginTop: 6 }}>
              <table>
                <thead><tr><th>AWB</th><th>Booked</th><th>Destination</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {d.recentShipments.map((s: any) => (
                    <tr key={s.awb}>
                      <td><Link to={`/tracker/${s.awb}`}><strong>{s.awb}</strong></Link></td>
                      <td>{dd(s.createdAt)}</td>
                      <td>{s.destination}</td>
                      <td><span className={`badge ${STATUS_CLS[s.statusCode] ?? 'CREATED'}`}>{s.statusCode}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link to={`/tracker/${s.awb}`}><button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }}>🧭 Track</button></Link>
                        {!['DLD', 'CAN', 'RTD'].includes(s.statusCode) && <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Request an appointment delivery date/time" onClick={() => setAppt({ awb: s.awb, date: '', remark: '' })}>📅 Appt</button>}
                        <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Leave a remark for CS" onClick={() => addRemark(s.awb)}>✎ Remark</button>
                        {s.hasPod && <Link to={`/tracker/${s.awb}`}><button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} title="View / download POD">📄 POD</button></Link>}
                        {['MAN', 'PKD'].includes(s.statusCode) && <CancelBtn awb={s.awb} onDone={() => api.portalOverview().then(setD)} />}
                      </td>
                    </tr>
                  ))}
                  {d.recentShipments.length === 0 && <tr><td colSpan={5} className="muted">No shipments yet — book your first one.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT: account + invoices */}
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>Account</h2>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <div><label>Outstanding</label><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--warn)' }}>{compact(cr.outstanding)}</div></div>
              <div><label>Overdue</label><div style={{ fontSize: 18, fontWeight: 700, color: '#b26a00' }}>{compact(cr.overdue)}</div></div>
              {d.client.accountType === 'WALLET' && <div><label>Wallet</label><div style={{ fontSize: 18, fontWeight: 700 }}>{compact(cr.walletBalance)}</div></div>}
              <div><label>Credit available</label><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ok)' }}>{compact(cr.available)}</div></div>
            </div>
          </div>
          {d.client?.canViewInvoices && <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>My invoices</h2><Link to="/invoices" className="muted" style={{ fontSize: 12 }}>all →</Link></div>
            <table style={{ marginTop: 6 }}>
              <tbody>
                {d.invoices.map((i: any) => (
                  <tr key={i.id}>
                    <td><Link to={`/invoices/${i.id}`}><strong>{i.invoiceNo}</strong></Link><div className="muted" style={{ fontSize: 11 }}>{dd(i.periodStart)}–{dd(i.periodEnd)}</div></td>
                    <td style={{ textAlign: 'right' }}>{inr(i.total)}<div className="muted" style={{ fontSize: 11 }}>due {inr(i.remaining)}</div></td>
                    <td><span className={`badge ${INV_CLS[i.paidStatus] ?? 'CREATED'}`}>{i.paidStatus}</span></td>
                    <td><a href={`/invoices/${i.id}/print`} target="_blank" rel="noreferrer"><button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }}>🖨</button></a></td>
                  </tr>
                ))}
                {d.invoices.length === 0 && <tr><td className="muted">No invoices yet.</td></tr>}
              </tbody>
            </table>
          </div>}
        </div>
      </div>
    </>
  );
}

function CancelBtn({ awb, onDone }: { awb: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    const reason = prompt(`Cancel shipment ${awb}? Enter a reason (optional):`, '');
    if (reason === null) return;
    setBusy(true);
    try { await api.cancelShipment(awb, reason || undefined); onDone(); }
    catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };
  return <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginLeft: 4 }} disabled={busy} onClick={cancel} title="Cancel this shipment">✕ Cancel</button>;
}
