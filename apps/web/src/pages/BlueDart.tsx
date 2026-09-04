import { useEffect, useState } from 'react';
import { api } from '../api';

/** BlueDart integration — connectivity check + read-only probes (serviceability, tracking).
 *  Credentials live in the droplet .env (BLUEDART_*); this page only verifies they work. */
export function BlueDart() {
  const [status, setStatus] = useState<{ configured: boolean; [k: string]: any } | null>(null);
  const [err, setErr] = useState('');
  const [tokenMsg, setTokenMsg] = useState('');
  const [pin, setPin] = useState('');
  const [svc, setSvc] = useState<any>(null);
  const [awb, setAwb] = useState('');
  const [track, setTrack] = useState<any>(null);
  const [busy, setBusy] = useState('');

  // Delhivery
  const [dStatus, setDStatus] = useState<{ configured: boolean; [k: string]: any } | null>(null);
  const [dPin, setDPin] = useState('');
  const [dSvc, setDSvc] = useState<any>(null);
  const [dAwb, setDAwb] = useState('');
  const [dTrack, setDTrack] = useState<any>(null);

  const load = () => {
    api.bdStatus().then(setStatus).catch((e) => setErr(e.message));
    api.delStatus().then(setDStatus).catch(() => {});
  };
  useEffect(load, []);
  const dCheckSvc = async () => { setErr(''); setDSvc(null); if (!dPin.trim()) return; setBusy('dsvc'); try { setDSvc(await api.delServiceable(dPin.trim())); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const dCheckTrack = async () => { setErr(''); setDTrack(null); if (!dAwb.trim()) return; setBusy('dtrack'); try { setDTrack(await api.delTrack(dAwb.trim())); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };

  const testToken = async () => {
    setErr(''); setTokenMsg(''); setBusy('token');
    try { const r = await api.bdTokenTest(); setTokenMsg(r.ok ? `✓ Authenticated — JWT ${r.tokenPreview}` : 'Auth returned no token.'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const checkSvc = async () => {
    setErr(''); setSvc(null); if (!pin.trim()) return; setBusy('svc');
    try { setSvc(await api.bdServiceable(pin.trim())); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const checkTrack = async () => {
    setErr(''); setTrack(null); if (!awb.trim()) return; setBusy('track');
    try { setTrack(await api.bdTrack(awb.trim())); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const vars = ['baseUrl', 'authUrl', 'clientId', 'loginId', 'licKey'];

  return (
    <>
      <h1>🚚 Carrier integrations</h1>
      <p className="muted" style={{ marginTop: -14 }}>Connectivity checks for the carrier APIs. Credentials are set on the server (<code>.env</code>), never here.</p>
      {err && <div className="error">{err}</div>}
      <h2 style={{ margin: '4px 0' }}>BlueDart</h2>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Configuration</h2>
          <span className={`badge ${status?.configured ? 'DELIVERED' : 'CANCELLED'}`}>{status?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
        </div>
        {status ? (
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            {vars.map((v) => (
              <span key={v} style={{ fontSize: 13 }}>
                <span className="muted">{v}:</span> {status[v] === 'set' ? <b style={{ color: 'var(--ok)' }}>set</b> : <b style={{ color: 'var(--bad, #c0392b)' }}>missing</b>}
              </span>
            ))}
          </div>
        ) : <p className="muted">Loading…</p>}
        {status && !status.configured && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Set these on the droplet <code>.env</code> and restart:
            <code style={{ display: 'block', marginTop: 6, whiteSpace: 'pre', fontSize: 12 }}>{`BLUEDART_BASE_URL=…\nBLUEDART_AUTH_URL=…\nBLUEDART_CLIENT_ID=…\nBLUEDART_CLIENT_SECRET=…\nBLUEDART_LOGINID=…\nBLUEDART_LICKEY=…`}</code>
          </p>
        )}
        <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center' }}>
          <button onClick={testToken} disabled={busy === 'token' || !status?.configured}>{busy === 'token' ? 'Testing…' : '🔑 Test authentication'}</button>
          <button className="secondary" onClick={load}>↻ Refresh</button>
          {tokenMsg && <span style={{ color: 'var(--ok)', fontSize: 13, fontWeight: 600 }}>{tokenMsg}</span>}
        </div>
      </div>

      <div className="grid cols-2" style={{ gap: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pincode serviceability</h2>
          <div className="row" style={{ gap: 8 }}>
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="e.g. 400001" style={{ width: 160 }} />
            <button onClick={checkSvc} disabled={busy === 'svc' || !status?.configured}>{busy === 'svc' ? 'Checking…' : 'Check'}</button>
          </div>
          {svc && <pre style={{ marginTop: 10, maxHeight: 300, overflow: 'auto', background: 'var(--bg-soft, #f1f3f6)', padding: 10, borderRadius: 8, fontSize: 12 }}>{JSON.stringify(svc, null, 2)}</pre>}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Track a BlueDart AWB</h2>
          <div className="row" style={{ gap: 8 }}>
            <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="BlueDart waybill no." style={{ width: 200 }} />
            <button onClick={checkTrack} disabled={busy === 'track' || !status?.configured}>{busy === 'track' ? 'Tracking…' : 'Track'}</button>
          </div>
          {track && <pre style={{ marginTop: 10, maxHeight: 300, overflow: 'auto', background: 'var(--bg-soft, #f1f3f6)', padding: 10, borderRadius: 8, fontSize: 12 }}>{JSON.stringify(track, null, 2)}</pre>}
        </div>
      </div>

      <h2 style={{ margin: '18px 0 4px' }}>Delhivery</h2>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Configuration</h2>
          <span className={`badge ${dStatus?.configured ? 'DELIVERED' : 'CANCELLED'}`}>{dStatus?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
        </div>
        {dStatus ? (
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            {['token', 'baseUrl', 'pickupName'].map((v) => (
              <span key={v} style={{ fontSize: 13 }}><span className="muted">{v}:</span> {(dStatus[v] === 'set' || (v !== 'token' && dStatus[v] && dStatus[v] !== 'missing')) ? <b style={{ color: 'var(--ok)' }}>{v === 'token' ? 'set' : dStatus[v]}</b> : <b style={{ color: 'var(--bad, #c0392b)' }}>missing</b>}</span>
            ))}
          </div>
        ) : <p className="muted">Loading…</p>}
        {dStatus && !dStatus.configured && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Set on the droplet <code>.env</code> and restart:
            <code style={{ display: 'block', marginTop: 6, whiteSpace: 'pre', fontSize: 12 }}>{`DELHIVERY_API_TOKEN=…\nDELHIVERY_BASE_URL=https://track.delhivery.com\nDELHIVERY_PICKUP_NAME=LOGIMARTTECHNOLOGIESLTDB2C`}</code>
          </p>
        )}
      </div>
      <div className="grid cols-2" style={{ gap: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pincode serviceability</h2>
          <div className="row" style={{ gap: 8 }}>
            <input value={dPin} onChange={(e) => setDPin(e.target.value)} placeholder="e.g. 400001" style={{ width: 160 }} />
            <button onClick={dCheckSvc} disabled={busy === 'dsvc' || !dStatus?.configured}>{busy === 'dsvc' ? 'Checking…' : 'Check'}</button>
          </div>
          {dSvc && <pre style={{ marginTop: 10, maxHeight: 300, overflow: 'auto', background: 'var(--bg-soft, #f1f3f6)', padding: 10, borderRadius: 8, fontSize: 12 }}>{JSON.stringify(dSvc, null, 2)}</pre>}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Track a Delhivery waybill</h2>
          <div className="row" style={{ gap: 8 }}>
            <input value={dAwb} onChange={(e) => setDAwb(e.target.value)} placeholder="Delhivery waybill no." style={{ width: 200 }} />
            <button onClick={dCheckTrack} disabled={busy === 'dtrack' || !dStatus?.configured}>{busy === 'dtrack' ? 'Tracking…' : 'Track'}</button>
          </div>
          {dTrack && <pre style={{ marginTop: 10, maxHeight: 300, overflow: 'auto', background: 'var(--bg-soft, #f1f3f6)', padding: 10, borderRadius: 8, fontSize: 12 }}>{JSON.stringify(dTrack, null, 2)}</pre>}
        </div>
      </div>
    </>
  );
}
