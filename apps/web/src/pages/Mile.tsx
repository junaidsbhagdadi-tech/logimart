import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const MILE_LABEL: Record<string, string> = { first: 'First Mile', mid: 'Mid Mile', last: 'Last Mile' };

/** One scan screen: scan/enter AWB(s) → set a milestone code. Bulk = textarea, pod = POD upload (DLD). */
export function MileScan({ title, code, bulk, pod, hint }: { title: string; code: string; bulk?: boolean; pod?: boolean; hint?: string }) {
  const [awb, setAwb] = useState('');
  const [remark, setRemark] = useState('');
  const [podData, setPodData] = useState('');
  const [podName, setPodName] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = (f?: File) => {
    if (!f) return;
    if (!/(jpeg|jpg|png|pdf)$/i.test(f.name) && !/(image\/(jpeg|png)|application\/pdf)/.test(f.type)) { setErr('POD must be JPG, PNG or PDF.'); return; }
    if (f.size > 6_000_000) { setErr('File too large (max ~6MB).'); return; }
    const r = new FileReader(); r.onload = () => { setPodData(String(r.result)); setPodName(f.name); setErr(''); }; r.readAsDataURL(f);
  };

  const submit = async () => {
    setErr(''); setMsg('');
    const awbs = awb.split(/[\s,\n]+/).map((a) => a.trim()).filter(Boolean);
    if (!awbs.length) { setErr('Scan or enter an AWB.'); return; }
    if (pod && !podData) { setErr('POD image is mandatory to mark Delivered (JPG / PNG / PDF).'); return; }
    setBusy(true);
    try {
      const r = await api.lifecycleScan({ awbs, code, remark: remark || undefined, podDataUrl: pod ? podData : undefined });
      setMsg(`✓ ${code}: ${r.updated}/${awbs.length} updated${r.missing.length ? ` · not found: ${r.missing.join(', ')}` : ''}${r.locked?.length ? ` · 🔒 out of sequence / terminal (super-admin only): ${r.locked.join(', ')}` : ''}`);
      if (r.done.length) setLog((l) => [`${new Date().toLocaleTimeString()} · ${code} · ${r.done.join(', ')}`, ...l].slice(0, 40));
      setAwb(''); setRemark(''); setPodData(''); setPodName('');
      inputRef.current?.focus();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h1>{title}</h1>
      {hint && <p className="muted" style={{ marginTop: -14 }}>{hint}</p>}
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}
      <div className="card">
        {bulk ? (
          <>
            <label>AWBs <span className="muted">(one per line, or comma/space separated)</span></label>
            <textarea rows={6} value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="L1000000123&#10;L1000000124…" style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11 }} />
          </>
        ) : (
          <>
            <label>Scan / enter AWB</label>
            <input ref={inputRef} autoFocus value={awb} onChange={(e) => setAwb(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && !pod) submit(); }} placeholder="L1000000123" />
          </>
        )}
        {(code === 'UDL') && (
          <div style={{ marginTop: 10 }}><label>Reason</label><input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Customer not available / refused…" /></div>
        )}
        {pod && (
          <div style={{ marginTop: 10 }}>
            <label>POD image (JPG / PNG / PDF) — <strong>mandatory</strong></label>
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(e) => readFile(e.target.files?.[0])} />
            {podName && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>📎 {podName}</span>}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={submit} disabled={busy}>{busy ? 'Scanning…' : `Scan → ${code}`}</button>
        </div>
      </div>
      {log.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Session scans ({log.length})</h2>
          {log.map((l, i) => <div key={i} className="muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>{l}</div>)}
        </div>
      )}
    </>
  );
}

/** Manual scan update: choose any status code for one/many AWBs. DLD needs a POD; terminal states
 *  (DLD/RTD/CAN) are locked server-side unless you're a super admin. */
export function ManualScan() {
  const [awb, setAwb] = useState('');
  const [code, setCode] = useState('PKD');
  const [remark, setRemark] = useState('');
  const [podData, setPodData] = useState(''); const [podName, setPodName] = useState('');
  const [codes, setCodes] = useState<{ code: string; label: string }[]>([]);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.lifecycleSummary().then((r) => setCodes(r.lifecycle)).catch(() => {}); }, []);

  const readFile = (f?: File) => {
    if (!f) return;
    if (!/(jpeg|jpg|png|pdf)$/i.test(f.name) && !/(image\/(jpeg|png)|application\/pdf)/.test(f.type)) { setErr('POD must be JPG, PNG or PDF.'); return; }
    if (f.size > 6_000_000) { setErr('File too large (max ~6MB).'); return; }
    const r = new FileReader(); r.onload = () => { setPodData(String(r.result)); setPodName(f.name); setErr(''); }; r.readAsDataURL(f);
  };

  const submit = async () => {
    setErr(''); setMsg('');
    const awbs = awb.split(/[\s,\n]+/).map((a) => a.trim()).filter(Boolean);
    if (!awbs.length) { setErr('Enter one or more AWBs.'); return; }
    if (code === 'DLD' && !podData) { setErr('POD image is mandatory for Delivered (JPG / PNG / PDF).'); return; }
    setBusy(true);
    try {
      const r = await api.lifecycleScan({ awbs, code, remark: remark || undefined, podDataUrl: code === 'DLD' ? podData : undefined });
      let m = `✓ ${code}: ${r.updated}/${awbs.length} updated`;
      if (r.missing?.length) m += ` · not found: ${r.missing.join(', ')}`;
      if (r.locked?.length) m += ` · 🔒 out of sequence / terminal (super-admin only): ${r.locked.join(', ')}`;
      setMsg(m); setAwb(''); setRemark(''); setPodData(''); setPodName('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h1>✍ Update Scans (manual)</h1>
      <p className="muted" style={{ marginTop: -14 }}>Set a status for one or more AWBs. Scans must follow the sequence <strong>MAN → PKD → ORD → DPD → DRD → OFD → DLD</strong> (CAN only right after MAN; UDL→re-attempt/RTO→RTD). Out-of-sequence and terminal (DLD/RTD/CAN) changes are super-admin only.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}
      <div className="card">
        <div className="grid cols-2">
          <div>
            <label>Status</label>
            <select value={code} onChange={(e) => setCode(e.target.value)}>
              {codes.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </div>
          <div><label>Remark <span className="muted">(optional)</span></label><input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="reason / note" /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>AWBs <span className="muted">(one per line, or comma/space separated)</span></label>
          <textarea rows={4} value={awb} onChange={(e) => setAwb(e.target.value.toUpperCase())} placeholder="L1000000123&#10;L1000000124…" style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11 }} />
        </div>
        {code === 'DLD' && (
          <div style={{ marginTop: 10 }}>
            <label>POD image (JPG / PNG / PDF) — <strong>mandatory</strong></label>
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(e) => readFile(e.target.files?.[0])} />
            {podName && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>📎 {podName}</span>}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={submit} disabled={busy}>{busy ? 'Updating…' : `Update → ${code}`}</button>
        </div>
      </div>
    </>
  );
}

/** Dashboard for a mile: stat card per milestone code + click-through worklist. */
export function MileDashboard({ mile }: { mile: 'first' | 'mid' | 'last' }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lifecycle, setLifecycle] = useState<{ code: string; label: string; mile: string }[]>([]);
  const [sel, setSel] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.lifecycleSummary().then((r) => { setCounts(r.counts); setLifecycle(r.lifecycle); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const codes = lifecycle.filter((l) => l.mile === mile);
  const openCode = (c: string) => { setSel(c); api.lifecycleList(c).then(setRows).catch(() => setRows([])); };
  const labelOf = (c: string) => lifecycle.find((l) => l.code === c)?.label || c;

  return (
    <>
      <h1>{MILE_LABEL[mile]} — Dashboard</h1>
      <div className="grid cols-4" style={{ gap: 12 }}>
        {codes.map((c) => (
          <button key={c.code} className="card" style={{ textAlign: 'left', cursor: 'pointer', border: sel === c.code ? '2px solid var(--brand)' : undefined }} onClick={() => openCode(c.code)}>
            <div className="muted" style={{ fontSize: 12 }}>{c.code} · {c.label}</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{counts[c.code] ?? 0}</div>
          </button>
        ))}
      </div>
      {sel && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{sel} · {labelOf(sel)} ({rows.length})</h2>
            <button className="secondary" onClick={() => { setSel(''); setRows([]); }}>✕</button>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>AWB</th><th>Route</th><th>Consignee</th><th>Vendor</th><th>Bag</th><th>At</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.awb}>
                  <td><strong>{s.awb}</strong></td>
                  <td>{s.originZone} → {s.destZone}{s.destPincode ? ` (${s.destPincode})` : ''}</td>
                  <td>{s.consigneeName ?? '—'}{s.consigneeCity ? ` · ${s.consigneeCity}` : ''}</td>
                  <td>{s.vendor ?? 'SELF'}</td>
                  <td>{s.bagCode ?? '—'}</td>
                  <td>{s.statusAt ? new Date(s.statusAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted">Nothing at this milestone.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Mid-mile bagging: scan AWBs into a bag code. */
export function Bagging() {
  const [bagCode, setBagCode] = useState('');
  const [awbs, setAwbs] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [bags, setBags] = useState<{ bagCode: string; shipments: number }[]>([]);
  const load = () => api.lifecycleBags().then(setBags).catch(() => {});
  useEffect(() => { load(); }, []);
  const submit = async () => {
    setErr(''); setMsg('');
    const list = awbs.split(/[\s,\n]+/).map((a) => a.trim()).filter(Boolean);
    if (!bagCode.trim()) { setErr('Bag code required.'); return; }
    if (!list.length) { setErr('Scan AWBs to bag.'); return; }
    try { const r = await api.lifecycleBag({ bagCode: bagCode.trim().toUpperCase(), awbs: list }); setMsg(`✓ Bagged ${r.bagged} into ${r.bagCode}`); setAwbs(''); load(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <h1>Bagging</h1>
      <p className="muted" style={{ marginTop: -14 }}>Group shipments into a bag for the mid-mile trip.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}
      <div className="card">
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div><label>Bag code</label><input value={bagCode} onChange={(e) => setBagCode(e.target.value.toUpperCase())} placeholder="BAG-BLR-HYD-001" /></div>
        </div>
        <label style={{ marginTop: 10, display: 'block' }}>AWBs <span className="muted">(one per line / comma / space)</span></label>
        <textarea rows={6} value={awbs} onChange={(e) => setAwbs(e.target.value)} style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11 }} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button onClick={submit}>Bag shipments</button></div>
      </div>
      <div className="card">
        <h2>Bags ({bags.length})</h2>
        <table>
          <thead><tr><th>Bag</th><th>Shipments</th></tr></thead>
          <tbody>{bags.map((b) => <tr key={b.bagCode}><td><strong>{b.bagCode}</strong></td><td>{b.shipments}</td></tr>)}
            {bags.length === 0 && <tr><td colSpan={2} className="muted">No bags yet.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}

/** Last-mile delivery update: Delivered (POD mandatory) or Undelivered (reason). Single or bulk. */
export function DeliveryUpdate({ bulk }: { bulk?: boolean }) {
  const [outcome, setOutcome] = useState<'DLD' | 'UDL'>('DLD');
  return (
    <>
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <button className={outcome === 'DLD' ? '' : 'secondary'} onClick={() => setOutcome('DLD')}>✅ Delivered (DLD)</button>
          <button className={outcome === 'UDL' ? '' : 'secondary'} onClick={() => setOutcome('UDL')}>⛔ Undelivered (UDL)</button>
        </div>
      </div>
      <MileScan key={outcome} title={bulk ? 'Bulk Delivery Update' : 'Update Delivery'} code={outcome} bulk={bulk}
        pod={outcome === 'DLD'} hint={outcome === 'DLD' ? 'Delivered — POD image is mandatory (JPG / PNG / PDF).' : 'Undelivered — enter a reason.'} />
    </>
  );
}

/** Mid-mile unloaded bags = the current open bags (reference list). */
export function UnloadedBags() {
  const [bags, setBags] = useState<{ bagCode: string; shipments: number }[]>([]);
  useEffect(() => { api.lifecycleBags().then(setBags).catch(() => {}); }, []);
  return (
    <>
      <h1>Unloaded Bags</h1>
      <p className="muted" style={{ marginTop: -14 }}>Bags received. Inscan their AWBs (Inscan Shipment → DRD) to hand off to last mile.</p>
      <div className="card">
        <table>
          <thead><tr><th>Bag</th><th>Shipments</th></tr></thead>
          <tbody>{bags.map((b) => <tr key={b.bagCode}><td><strong>{b.bagCode}</strong></td><td>{b.shipments}</td></tr>)}
            {bags.length === 0 && <tr><td colSpan={2} className="muted">No bags.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}
