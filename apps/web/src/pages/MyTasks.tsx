import { useEffect, useState } from 'react';
import { api } from '../api';

export function MyTasks() {
  const [pickups, setPickups] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => {
    api.riderTasks().then((r) => { setPickups(r.pickups); setDeliveries(r.deliveries); }).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const pickComplete = async (id: string) => {
    setBusy(id);
    try { await api.completePickup(id); setMsg('Pickup marked complete'); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };

  const ofd = async (awb: string) => {
    setBusy(awb);
    try { await api.markOfd(awb); setMsg(`${awb} is now Out For Delivery`); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };

  const deliver = async (d: any) => {
    setBusy(d.awb);
    setError(''); setMsg('');
    try {
      // capture POD photo
      const file = await pickImage();
      let stampPhotoUrl: string | undefined;
      if (file) stampPhotoUrl = (await api.uploadPod(file)).url;
      const short = d.delivered < d.pieceCount && !confirm(`Only ${d.delivered}/${d.pieceCount} delivered — record SHORT delivery?`) ? null : true;
      if (short === null) { setBusy(''); return; }
      const gps = await getGps();
      await api.recordPod(
        d.awb,
        { gpsLat: gps.lat, gpsLng: gps.lng, piecesDelivered: d.pieceCount, stampPhotoUrl },
        d.delivered < d.pieceCount,
      );
      setMsg(`${d.awb} delivered${stampPhotoUrl ? ' with POD photo' : ''}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <h1>My Tasks</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <h2>📦 Pickups ({pickups.length})</h2>
        {pickups.length === 0 ? <p className="muted">No pickups assigned.</p> : pickups.map((p) => (
          <div key={p.id} className="task-row">
            <div>
              <strong>{p.pickupAddress}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{[p.city, p.pincode].filter(Boolean).join(' · ')} · {p.estPieces} boxes{p.contactPhone ? ` · 📞 ${p.contactPhone}` : ''}</div>
            </div>
            <button disabled={busy === p.id} onClick={() => pickComplete(p.id)}>{busy === p.id ? '…' : 'Picked ✓'}</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>🚚 Deliveries ({deliveries.length})</h2>
        {deliveries.length === 0 ? <p className="muted">No deliveries assigned.</p> : deliveries.map((d) => (
          <div key={d.awb} className="task-row">
            <div>
              <strong>{d.consigneeName || d.awb}</strong> <span className={`badge ${d.status}`}>{d.status}</span>
              <div className="muted" style={{ fontSize: 12 }}>{d.awb} · {d.address}</div>
              <div className="muted" style={{ fontSize: 12 }}>{d.delivered}/{d.pieceCount} boxes{d.consigneePhone ? ` · 📞 ${d.consigneePhone}` : ''}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {d.status !== 'OUT_FOR_DELIVERY' && <button className="secondary" disabled={busy === d.awb} onClick={() => ofd(d.awb)}>OFD</button>}
              <button disabled={busy === d.awb} onClick={() => deliver(d)}>{busy === d.awb ? '…' : '📷 Deliver'}</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Open the camera/file picker and resolve the chosen image (or null). */
function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
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
