import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Shipment } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../components/Logo';

/** Full-screen, phone-first delivery screen: find AWB → capture POD (JPG/PDF) → deliver. */
export function Deliver() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [awbInput, setAwbInput] = useState('');
  const [tasks, setTasks] = useState<any[]>([]);
  const [s, setS] = useState<Shipment | null>(null);
  const [pod, setPod] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const loadTasks = () => api.riderTasks().then((r) => setTasks(r.deliveries || [])).catch(() => {});
  useEffect(() => { loadTasks(); }, []);

  const open = async (awb: string) => {
    setError(''); setDone(''); setPod(null); setS(null);
    try { setS(await api.getShipment(awb.trim().toUpperCase())); }
    catch (e: any) { setError(e.message); }
  };

  const collectDod = async () => {
    if (!s) return;
    const reference = prompt(`${s.dodInstrument === 'DD' ? 'DD' : 'Cheque'} number collected:`);
    if (!reference) return;
    const bankName = prompt('Bank name (optional):') || undefined;
    setBusy(true); setError('');
    try { await api.collectDod(s.awb, { reference, bankName }); await open(s.awb); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const collectFreight = async () => {
    if (!s) return;
    const amt = Number(prompt('Freight collected (₹):', s.freightToCollect ?? ''));
    if (!amt) return;
    setBusy(true); setError('');
    try { await api.collectFreight(s.awb, amt); await open(s.awb); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const deliver = async () => {
    if (!s) return;
    // Field delivery flows through the single Last-Mile lifecycle (DLD): POD image is mandatory
    // and lands in shipment.podUrl, so it reflects on the Last-Mile dashboards.
    if (!pod) { setError('POD image (JPG / PNG / PDF) is required to mark Delivered.'); return; }
    setBusy(true); setError(''); setDone('');
    try {
      const podDataUrl = await fileToDataUrl(pod);
      await api.lifecycleScan({ awbs: [s.awb], code: 'DLD', podDataUrl });
      setDone(`✅ ${s.awb} delivered with POD.`);
      setS(null); setPod(null); setAwbInput(''); loadTasks();
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const dodBlocked = !!(s?.isDod && !s?.dodCollectedAt);

  return (
    <div className="deliver">
      <header className="deliver-top">
        <Logo height={26} />
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="deliver-user">{user?.fullName}</span>
          <button className="secondary" style={{ padding: '6px 12px' }} onClick={() => { logout(); nav('/login'); }}>Exit</button>
        </div>
      </header>

      <div className="deliver-body">
        <h2 style={{ marginTop: 4 }}>🚚 Delivery</h2>

        <div className="deliver-search">
          <input value={awbInput} onChange={(e) => setAwbInput(e.target.value)} placeholder="Enter / scan AWB…"
            onKeyDown={(e) => e.key === 'Enter' && awbInput.trim() && open(awbInput)} inputMode="text" autoCapitalize="characters" />
          <button disabled={!awbInput.trim()} onClick={() => open(awbInput)}>Find</button>
        </div>

        {error && <div className="error">{error}</div>}
        {done && <div className="deliver-done">{done}</div>}

        {!s && (
          <>
            <div className="deliver-label">My deliveries ({tasks.length})</div>
            {tasks.length === 0 && <p className="muted">No deliveries assigned. Enter an AWB above.</p>}
            {tasks.map((d) => (
              <button key={d.awb} className="deliver-task" onClick={() => open(d.awb)}>
                <div>
                  <strong>{d.consigneeName || d.awb}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{d.awb} · {d.address || ''}</div>
                </div>
                <span className={`badge ${d.status}`}>{d.status}</span>
              </button>
            ))}
          </>
        )}

        {s && (
          <div className="deliver-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 18 }}>{s.awb}</strong>
              <span className={`badge ${s.status}`}>{s.status}</span>
            </div>
            <div className="deliver-consignee">
              <div style={{ fontWeight: 700, fontSize: 17 }}>{s.consigneeName || '—'}</div>
              <div className="muted">{[s.consigneeAddress, s.consigneeCity, s.destPincode].filter(Boolean).join(', ')}</div>
              {s.consigneePhone && <a className="deliver-call" href={`tel:${s.consigneePhone}`}>📞 Call {s.consigneePhone}</a>}
              <div className="muted" style={{ marginTop: 4 }}>{s.rollup.pieceCount} box(es)</div>
            </div>

            {(s.paymentTerm === 'TO_PAY' || s.isDod) && (
              <div className={`deliver-collect ${dodBlocked ? 'warn' : ''}`}>
                {s.isDod && (
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>💷 DOD {s.dodInstrument === 'DD' ? 'DD' : 'cheque'} ₹{s.dodAmount} — {s.dodCollectedAt ? '✅ collected' : 'NOT collected'}</span>
                    {!s.dodCollectedAt && <button disabled={busy} onClick={collectDod}>Collect</button>}
                  </div>
                )}
                {s.paymentTerm === 'TO_PAY' && (
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: s.isDod ? 8 : 0 }}>
                    <span>💰 To-Pay freight ₹{s.freightToCollect} — {s.freightCollectedAt ? '✅ collected' : 'pending'}</span>
                    {!s.freightCollectedAt && <button className="secondary" disabled={busy} onClick={collectFreight}>Collect</button>}
                  </div>
                )}
              </div>
            )}

            <div className="deliver-pod">
              <div className="deliver-label">Proof of delivery</div>
              <div className="row" style={{ gap: 10 }}>
                <label className="deliver-cap">📷 Photo
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => setPod(e.target.files?.[0] ?? null)} />
                </label>
                <label className="deliver-cap secondary">📎 PDF
                  <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => setPod(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              {pod && (
                <div className="deliver-preview">
                  {pod.type.startsWith('image/')
                    ? <img src={URL.createObjectURL(pod)} alt="POD" />
                    : <span>📄 {pod.name}</span>}
                  <button className="secondary" style={{ padding: '4px 10px' }} onClick={() => setPod(null)}>✕</button>
                </div>
              )}
            </div>

            {dodBlocked && <div className="deliver-block">🔒 Collect the DOD {s.dodInstrument === 'DD' ? 'DD' : 'cheque'} before delivering.</div>}

            <div className="row" style={{ gap: 10, marginTop: 14 }}>
              <button className="secondary" style={{ flex: 1 }} onClick={() => { setS(null); setError(''); }}>← Back</button>
              <button style={{ flex: 2 }} disabled={busy || dodBlocked} onClick={deliver}>{busy ? 'Saving…' : '✅ Mark Delivered'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the POD file.'));
    r.readAsDataURL(file);
  });
}

function getGps(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: 0, lng: 0 });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }),
      () => resolve({ lat: 0, lng: 0 }),
      { timeout: 5000 },
    );
  });
}
