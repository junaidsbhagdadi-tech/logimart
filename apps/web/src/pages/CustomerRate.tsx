import { useEffect, useMemo, useState } from 'react';
import { api, Client } from '../api';

const RATE_TYPES = ['INITIAL', 'ADDITIONAL', 'UPTO', 'PLUS', 'PLUSKG'];
const UNITS = ['KG', 'PCS', 'CFT'];

type Slab = { rateType: string; weight: string; rate: string };

const blankHead = {
  clientId: '', fromDate: '', origin: '', vendor: '', product: '', zone: '',
  country: '', destination: '', service: '', unit: 'KG', days: '', originZone: '',
};

export function CustomerRate() {
  const [clients, setClients] = useState<Client[]>([]);
  const [head, setHead] = useState({ ...blankHead });
  const [slab, setSlab] = useState<Slab>({ rateType: 'INITIAL', weight: '', rate: '' });
  const [pending, setPending] = useState<Slab[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // master-driven lookups (Xpresion-style)
  const [zones, setZones] = useState<string[]>([]);
  const [prods, setProds] = useState<string[]>([]);
  const [dests, setDests] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);

  useEffect(() => {
    const codes = (r: any[]) => r.map((x) => x.code || x.name).filter(Boolean);
    const uniq = (a: string[]) => Array.from(new Set(a));
    api.listClients().then(setClients).catch(() => {});
    api.listMaster('ZONE').then((r) => setZones(uniq(['NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTHEAST', ...codes(r)]))).catch(() => setZones(['NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTHEAST']));
    api.listMaster('PRODUCT').then((r) => setProds(codes(r))).catch(() => {});
    api.listMaster('DESTINATION').then((r) => setDests(codes(r))).catch(() => {});
    api.listMaster('COUNTRY').then((r) => setCountries(r.map((x) => x.name || x.code).filter(Boolean))).catch(() => {});
    api.listVendors().then((r) => setVendors(uniq(['SELF', ...r.map((v: any) => v.name).filter(Boolean)]))).catch(() => setVendors(['SELF']));
    api.listServiceMappings().then((r) => setServices(uniq(r.map((m: any) => m.serviceType).filter(Boolean)))).catch(() => {});
  }, []);

  const loadRows = () => {
    api.listRateSlabs(head.clientId || undefined).then(setRows).catch((e) => setError(e.message));
  };
  useEffect(loadRows, [head.clientId]);

  const setH = (k: keyof typeof blankHead, v: string) => setHead((h) => ({ ...h, [k]: v }));
  // datalist-backed input: pick from the master OR type a free value (mirrors Xpresion's 🔍 lookups)
  const lookup = (k: keyof typeof blankHead, list: string[], ph?: string) => (
    <>
      <input list={`lm-${k}`} value={head[k]} onChange={(e) => setH(k, e.target.value)} placeholder={ph} />
      <datalist id={`lm-${k}`}>{list.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );

  const addToList = () => {
    setError('');
    if (!slab.weight || !slab.rate) { setError('Weight and Rate are required.'); return; }
    setPending((p) => [...p, slab]);
    setSlab({ rateType: slab.rateType, weight: '', rate: '' });
  };

  const saveAll = async () => {
    setError(''); setMsg('');
    const list = pending.length ? pending : (slab.weight && slab.rate ? [slab] : []);
    if (list.length === 0) { setError('Add at least one weight/rate slab.'); return; }
    setBusy(true);
    try {
      for (const s of list) {
        await api.addRateSlab({ ...head, clientId: head.clientId || undefined, rateType: s.rateType, weight: s.weight, rate: s.rate, fromDate: head.fromDate ? new Date(head.fromDate).toISOString() : undefined, days: head.days || undefined });
      }
      setMsg(`✓ Saved ${list.length} slab(s).`);
      setPending([]); setSlab({ rateType: 'INITIAL', weight: '', rate: '' });
      loadRows();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setError('');
    try { await api.delRateSlab(id); loadRows(); } catch (e: any) { setError(e.message); }
  };

  const clientName = useMemo(() => clients.find((c) => String(c.id) === head.clientId)?.legalName, [clients, head.clientId]);

  return (
    <>
      <h1>💱 Customer Rate</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <h2>Tariff header</h2>
        <div className="grid cols-4">
          <div>
            <label>Customer</label>
            <select value={head.clientId} onChange={(e) => setH('clientId', e.target.value)}>
              <option value="">— generic (all) —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
            </select>
          </div>
          <div><label>From Date</label><input type="date" value={head.fromDate} onChange={(e) => setH('fromDate', e.target.value)} /></div>
          <div><label>Origin</label>{lookup('origin', dests, 'origin hub / city')}</div>
          <div><label>Vendor</label>{lookup('vendor', vendors, 'SELF or vendor')}</div>

          <div><label>Product</label>{lookup('product', prods)}</div>
          <div><label>Zone</label>{lookup('zone', zones)}</div>
          <div><label>Country</label>{lookup('country', countries)}</div>
          <div><label>Destination</label>{lookup('destination', dests)}</div>

          <div><label>Service</label>{lookup('service', services)}</div>
          <div>
            <label>Unit</label>
            <select value={head.unit} onChange={(e) => setH('unit', e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
          </div>
          <div><label>Days (TAT)</label><input type="number" value={head.days} onChange={(e) => setH('days', e.target.value)} /></div>
          <div><label>Origin Zone</label>{lookup('originZone', zones)}</div>
        </div>
      </div>

      <div className="card">
        <h2>Weight slabs</h2>
        <div className="grid cols-4">
          <div>
            <label>Rate Type *</label>
            <select value={slab.rateType} onChange={(e) => setSlab((s) => ({ ...s, rateType: e.target.value }))}>{RATE_TYPES.map((r) => <option key={r}>{r}</option>)}</select>
          </div>
          <div><label>Weight *</label><input type="number" value={slab.weight} onChange={(e) => setSlab((s) => ({ ...s, weight: e.target.value }))} /></div>
          <div><label>Rate *</label><input type="number" value={slab.rate} onChange={(e) => setSlab((s) => ({ ...s, rate: e.target.value }))} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button className="secondary" onClick={addToList}>+ Add</button></div>
        </div>

        {pending.length > 0 && (
          <table style={{ marginTop: 14 }}>
            <thead><tr><th>Rate Type</th><th>Weight</th><th>Rate</th><th></th></tr></thead>
            <tbody>
              {pending.map((s, i) => (
                <tr key={i}><td>{s.rateType}</td><td>{s.weight}</td><td>₹{s.rate}</td>
                  <td><button className="secondary" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>✕</button></td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 12 }}><button onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>

      <div className="card">
        <h2>Tariff — {clientName ? clientName : 'all customers'} ({rows.length})</h2>
        <table>
          <thead><tr><th>Customer</th><th>Vendor</th><th>Product</th><th>Zone</th><th>Dest</th><th>Service</th><th>Unit</th><th>Type</th><th>Weight</th><th>Rate</th><th>Days</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const cn = clients.find((c) => String(c.id) === String(r.clientId))?.accountCode;
              return (
                <tr key={r.id}>
                  <td>{cn ?? (r.clientId ? r.clientId : 'ALL')}</td><td>{r.vendor ?? '—'}</td><td>{r.product ?? '—'}</td>
                  <td>{r.zone ?? '—'}</td><td>{r.destination ?? '—'}</td><td>{r.service ?? '—'}</td><td>{r.unit ?? '—'}</td>
                  <td><span className="badge CREATED">{r.rateType}</span></td><td>{r.weight}</td><td>₹{r.rate}</td><td>{r.days ?? '—'}</td>
                  <td><button className="secondary" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => remove(String(r.id))}>✕</button></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={12} className="muted">No tariff slabs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
