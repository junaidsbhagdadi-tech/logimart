import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';

/** BlueDart integration — connectivity check + read-only probes (serviceability, tracking).
 *  Credentials live in the droplet .env (BLUEDART_*); this page only verifies they work. */
export function BlueDart() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => clearTimeout(t);
  }, [hash]);
  const [status, setStatus] = useState<{ configured: boolean; [k: string]: any } | null>(null);
  const [err, setErr] = useState('');
  const [tokenMsg, setTokenMsg] = useState('');
  const [pin, setPin] = useState('');
  const [svc, setSvc] = useState<any>(null);
  const [awb, setAwb] = useState('');
  const [track, setTrack] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [syncAllMsg, setSyncAllMsg] = useState('');
  const [dispatchMsg, setDispatchMsg] = useState('');
  const [dispatchStat, setDispatchStat] = useState<{ pending: number; failed: number; running: boolean } | null>(null);
  // BlueDart account codes (config of all accounts; manual pick at booking)
  const accBlank = { id: '', label: '', accountCode: '', areaCode: '', loginId: '', licKey: '', trackLoginId: '', trackLicKey: '', customerCode: '', isDefault: false, active: true };
  const [accounts, setAccounts] = useState<any[]>([]);
  const [acc, setAcc] = useState<any>({ ...accBlank });
  const [accMsg, setAccMsg] = useState('');
  const loadAccounts = () => api.bdAccounts().then(setAccounts).catch(() => {});
  const setAccF = (k: string, v: any) => setAcc((a: any) => ({ ...a, [k]: v }));
  const editAcc = (a: any) => { setAcc({ ...accBlank, id: a.id, label: a.label, accountCode: a.accountCode ?? '', areaCode: a.areaCode, loginId: a.loginId, customerCode: a.customerCode, trackLoginId: a.trackLoginId ?? '', isDefault: a.isDefault, active: a.active, licKey: '', trackLicKey: '' }); setAccMsg('Leave the licence-key fields blank to keep the existing keys.'); };
  const saveAcc = async () => { setErr(''); try { await api.bdSaveAccount(acc); setAccMsg('✓ Account saved.'); setAcc({ ...accBlank }); loadAccounts(); } catch (e: any) { setErr(e.message); } };
  const delAcc = async (id: string) => { if (!confirm('Delete this BlueDart account?')) return; try { await api.bdDeleteAccount(id); loadAccounts(); } catch (e: any) { setErr(e.message); } };

  // Delhivery
  const [dStatus, setDStatus] = useState<{ configured: boolean; [k: string]: any } | null>(null);
  const [gStatus, setGStatus] = useState<{ configured: boolean; [k: string]: any } | null>(null);
  const [xStatus, setXStatus] = useState<{ configured: boolean; tracking: boolean; pool?: { kind: string; routeMode: string; free: number; total: number }[]; [k: string]: any } | null>(null);
  const [dPin, setDPin] = useState('');
  const [dSvc, setDSvc] = useState<any>(null);
  const [dOrigin, setDOrigin] = useState('');
  const [dDest, setDDest] = useState('');
  const [dTat, setDTat] = useState<any>(null);

  const load = () => {
    api.bdStatus().then(setStatus).catch((e) => setErr(e.message));
    api.delStatus().then(setDStatus).catch(() => {});
    api.xbStatus().then(setXStatus).catch(() => {});
    api.gatiStatus().then(setGStatus).catch(() => {});
    api.bdDispatchStatus().then(setDispatchStat).catch(() => {});
    loadAccounts();
  };
  const sendToBd = async () => {
    setErr(''); setDispatchMsg(''); setBusy('dispatch');
    try { const r = await api.bdDispatchAll(); setDispatchMsg(r.message); setTimeout(() => api.bdDispatchStatus().then(setDispatchStat).catch(() => {}), 1500); }
    catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  useEffect(load, []);
  const dCheckSvc = async () => { setErr(''); setDSvc(null); if (!dPin.trim()) return; setBusy('dsvc'); try { setDSvc(await api.delServiceable(dPin.trim())); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const dCheckTat = async () => { setErr(''); setDTat(null); if (!dOrigin.trim() || !dDest.trim()) return; setBusy('dtat'); try { setDTat(await api.delTat(dOrigin.trim(), dDest.trim())); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };

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
  const backfill = async () => {
    setErr(''); setSyncAllMsg(''); setBusy('syncall');
    try { const r = await api.bdSyncAll(); setSyncAllMsg(`${r.message} (${r.pending} of ${r.total} not yet synced)`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const vars = ['baseUrl', 'authUrl', 'clientId', 'loginId', 'licKey'];

  return (
    <>
      <h1>🚚 Carrier integrations</h1>
      <p className="muted" style={{ marginTop: -14 }}>Connectivity checks for the carrier APIs. Credentials are set on the server (<code>.env</code>), never here.</p>
      {err && <div className="error">{err}</div>}
      <h2 id="bluedart" style={{ margin: '4px 0' }}>BlueDart</h2>

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
          <button className="secondary" onClick={backfill} disabled={busy === 'syncall' || !status?.configured} title="Sync tracking for ALL BlueDart shipments (any age) — safe to re-run">{busy === 'syncall' ? 'Syncing…' : '🔄 Backfill tracking'}</button>
          <button onClick={sendToBd} disabled={busy === 'dispatch' || !status?.configured} title="Generate the AWB + register the pickup with BlueDart for every booked BD shipment that hasn't been sent yet">{busy === 'dispatch' ? 'Sending…' : '📤 Send pending to BlueDart'}{dispatchStat ? ` (${dispatchStat.pending})` : ''}</button>
          <button className="secondary" onClick={load}>↻ Refresh</button>
          {tokenMsg && <span style={{ color: 'var(--ok)', fontSize: 13, fontWeight: 600 }}>{tokenMsg}</span>}
          {syncAllMsg && <span style={{ color: 'var(--ok)', fontSize: 13, fontWeight: 600 }}>{syncAllMsg}</span>}
          {dispatchMsg && <span style={{ color: 'var(--ok)', fontSize: 13, fontWeight: 600 }}>{dispatchMsg}</span>}
        </div>
        {dispatchStat && (dispatchStat.pending > 0 || dispatchStat.failed > 0) && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Auto-dispatch runs every ~5 min. <strong>{dispatchStat.pending}</strong> BlueDart shipment(s) awaiting hand-off{dispatchStat.failed > 0 ? <>, of which <strong style={{ color: 'var(--bad, #c0392b)' }}>{dispatchStat.failed}</strong> failed (bad data / out-of-area) — fix on Edit AWB & they retry.</> : '.'}{dispatchStat.running ? ' A run is in progress…' : ''}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>BlueDart accounts <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>— all account codes; ops picks one at booking</span></h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>Each account = one origin area (BOM/DEL/GZB…) with its own login + shipping licence key + customer code. Mark one <strong>default</strong>. Hand-off &amp; pickup use the account picked on the shipment (or the default).</p>
        <div className="grid cols-4" style={{ gap: 10 }}>
          <div><label>Label *</label><input value={acc.label} onChange={(e) => setAccF('label', e.target.value)} placeholder="Mumbai — BOM439154" /></div>
          <div><label>Account code</label><input value={acc.accountCode} onChange={(e) => setAccF('accountCode', e.target.value)} placeholder="BOM439154" /></div>
          <div><label>Area code *</label><input value={acc.areaCode} maxLength={3} onChange={(e) => setAccF('areaCode', e.target.value.toUpperCase())} placeholder="BOM" /></div>
          <div><label>Customer code *</label><input value={acc.customerCode} onChange={(e) => setAccF('customerCode', e.target.value)} placeholder="439154" /></div>
          <div><label>Shipping login id *</label><input value={acc.loginId} onChange={(e) => setAccF('loginId', e.target.value)} placeholder="BOM27377" /></div>
          <div><label>Shipping licence key{acc.id ? ' (blank = keep)' : ' *'}</label><input value={acc.licKey} onChange={(e) => setAccF('licKey', e.target.value)} placeholder="32-char key" /></div>
          <div><label>Tracking login id</label><input value={acc.trackLoginId} onChange={(e) => setAccF('trackLoginId', e.target.value)} placeholder="optional" /></div>
          <div><label>Tracking licence key{acc.id ? ' (blank = keep)' : ''}</label><input value={acc.trackLicKey} onChange={(e) => setAccF('trackLicKey', e.target.value)} placeholder="optional" /></div>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <label className="row" style={{ gap: 4, fontSize: 13, margin: 0 }}><input type="checkbox" checked={acc.isDefault} onChange={(e) => setAccF('isDefault', e.target.checked)} style={{ width: 'auto' }} />Default</label>
            <label className="row" style={{ gap: 4, fontSize: 13, margin: 0 }}><input type="checkbox" checked={acc.active} onChange={(e) => setAccF('active', e.target.checked)} style={{ width: 'auto' }} />Active</label>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button onClick={saveAcc} disabled={!acc.label || !acc.areaCode || !acc.customerCode || !acc.loginId}>{acc.id ? 'Save changes' : 'Add account'}</button>
          {acc.id && <button className="secondary" onClick={() => { setAcc({ ...accBlank }); setAccMsg(''); }}>Cancel edit</button>}
          {accMsg && <span className="muted" style={{ fontSize: 12 }}>{accMsg}</span>}
        </div>
        <table style={{ fontSize: 13, marginTop: 12 }}>
          <thead><tr><th>Label</th><th>Area</th><th>Cust code</th><th>Login</th><th>Ship key</th><th>Default</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td><td>{a.areaCode}</td><td>{a.customerCode}</td><td>{a.loginId}</td>
                <td>{a.licKeySet ? `…${a.licKeyLast4}` : <span style={{ color: 'var(--bad, #c0392b)' }}>missing</span>}</td>
                <td>{a.isDefault ? '✓' : '—'}</td><td>{a.active ? '✓' : '—'}</td>
                <td className="row" style={{ gap: 4 }}><button className="secondary" style={{ padding: '2px 8px' }} onClick={() => editAcc(a)}>✎</button><button className="secondary" style={{ padding: '2px 8px' }} onClick={() => delAcc(a.id)}>🗑</button></td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={8} className="muted">No BlueDart accounts configured — add one above (the single .env account is used until then).</td></tr>}
          </tbody>
        </table>
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

      <h2 id="gati" style={{ margin: '18px 0 4px' }}>Gati (Allcargo)</h2>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Configuration</h2>
          <span className={`badge ${gStatus?.configured ? 'DELIVERED' : 'CANCELLED'}`}>{gStatus?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
        </div>
        {gStatus ? (
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            {['custCode', 'encCustCode', 'trackToken', 'pinReqId', 'defaultGoodsCode', 'env'].map((v) => (
              <span key={v} style={{ fontSize: 13 }}><span className="muted">{v}:</span> {(gStatus[v] && !['missing', 'not set'].includes(gStatus[v])) ? <b style={{ color: 'var(--ok)' }}>{gStatus[v]}</b> : <b style={{ color: 'var(--bad, #c0392b)' }}>{gStatus[v] || 'missing'}</b>}</span>
            ))}
          </div>
        ) : <p className="muted">Loading…</p>}
        {gStatus && !gStatus.configured && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Set on the droplet <code>.env</code> and restart (Allcargo must whitelist IP <b>168.144.77.53</b>): <code>GATI_CUST_CODE</code>, <code>GATI_ENC_CUST_CODE</code>, <code>GATI_TRACK_TOKEN</code>, <code>GATI_PIN_REQID</code>, optional <code>GATI_DEFAULT_GOODS_CODE</code>, <code>GATI_ENV=uat</code> to test.</p>
        )}
      </div>

      <h2 id="xpressbees" style={{ margin: '18px 0 4px' }}>XpressBees</h2>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Configuration</h2>
          <span className={`badge ${xStatus?.configured ? 'DELIVERED' : 'CANCELLED'}`}>{xStatus?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
        </div>
        {xStatus ? (
          <>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              {['key', 'awbToken', 'pickupLocation', 'defaultCategory', 'env'].map((v) => (
                <span key={v} style={{ fontSize: 13 }}><span className="muted">{v}:</span> {(xStatus[v] && !['missing', 'not set'].includes(xStatus[v])) ? <b style={{ color: 'var(--ok)' }}>{xStatus[v]}</b> : <b style={{ color: 'var(--bad, #c0392b)' }}>{xStatus[v] || 'missing'}</b>}</span>
              ))}
              <span style={{ fontSize: 13 }}><span className="muted">tracking:</span> <b style={{ color: xStatus.tracking ? 'var(--ok)' : 'var(--bad, #c0392b)' }}>{xStatus.tracking ? 'set' : 'missing'}</b></span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
              AWB number pool (XpressBees issues 1,000 at a time): {xStatus.pool?.length
                ? xStatus.pool.map((p) => `${p.kind === 'AWB' ? 'parent AWB' : 'box id'} ${p.routeMode}: ${p.free} free / ${p.total}`).join(' · ')
                : 'empty — fills automatically on the first hand-off.'}
            </p>
          </>
        ) : <p className="muted">Loading…</p>}
        {xStatus && !xStatus.configured && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>B2B cargo API. Set on the droplet <code>.env</code> and restart (and ask XpressBees to whitelist IP <b>168.144.77.53</b>):
            <code style={{ display: 'block', marginTop: 6, whiteSpace: 'pre', fontSize: 12 }}>{`XB_KEY=…                 # XBKey (manifest / pickup / cancel)
XB_AWB_TOKEN=…           # token for bulk AWB generation
XB_TRACK_USERNAME=…  XB_TRACK_PASSWORD=…  XB_TRACK_SECRET=…
XB_PICKUP_LOCATION=…     # registered pickup location id
XB_DEFAULT_CATEGORY=…    # e.g. Garments / Auto Parts (used when content doesn't say)
# production URLs (defaults are XpressBees' staging): XB_MANIFEST_URL, XB_AWB_URL, XB_PICKUP_URL`}</code>
          </p>
        )}
      </div>

      <h2 id="delhivery" style={{ margin: '18px 0 4px' }}>Delhivery</h2>
      {err && <div className="error">{err}</div>}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Configuration</h2>
          <span className={`badge ${dStatus?.configured ? 'DELIVERED' : 'CANCELLED'}`}>{dStatus?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
        </div>
        {dStatus ? (
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            {['username', 'password', 'baseUrl', 'pickupName', 'env'].map((v) => (
              <span key={v} style={{ fontSize: 13 }}><span className="muted">{v}:</span> {(dStatus[v] && dStatus[v] !== 'missing') ? <b style={{ color: 'var(--ok)' }}>{dStatus[v]}</b> : <b style={{ color: 'var(--bad, #c0392b)' }}>missing</b>}</span>
            ))}
          </div>
        ) : <p className="muted">Loading…</p>}
        {dStatus && !dStatus.configured && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>B2B / LTL API. Set on the droplet <code>.env</code> and restart:
            <code style={{ display: 'block', marginTop: 6, whiteSpace: 'pre', fontSize: 12 }}>{`DELHIVERY_USERNAME=…\nDELHIVERY_PASSWORD=…\nDELHIVERY_BASE_URL=https://ltl-clients-api.delhivery.com   # or ...-dev for staging\nDELHIVERY_PICKUP_NAME=your_registered_warehouse_name`}</code>
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
          <h2 style={{ marginTop: 0 }}>Expected TAT (origin → dest)</h2>
          <div className="row" style={{ gap: 8 }}>
            <input value={dOrigin} onChange={(e) => setDOrigin(e.target.value)} placeholder="origin PIN" style={{ width: 120 }} />
            <input value={dDest} onChange={(e) => setDDest(e.target.value)} placeholder="dest PIN" style={{ width: 120 }} />
            <button onClick={dCheckTat} disabled={busy === 'dtat' || !dStatus?.configured}>{busy === 'dtat' ? 'Checking…' : 'Get TAT'}</button>
          </div>
          {dTat && <pre style={{ marginTop: 10, maxHeight: 300, overflow: 'auto', background: 'var(--bg-soft, #f1f3f6)', padding: 10, borderRadius: 8, fontSize: 12 }}>{JSON.stringify(dTat, null, 2)}</pre>}
        </div>
      </div>
    </>
  );
}
