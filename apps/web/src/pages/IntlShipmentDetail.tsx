import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate } from '../format';

const STATUSES = ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'ARRIVED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const CHARGE_CODES = ['FREIGHT', 'FUEL', 'CUSTOMS', 'CLEARANCE', 'HANDLING', 'DO', 'THC', 'DOCUMENTATION', 'PICKUP', 'DELIVERY', 'INSURANCE', 'MISC'];

function F({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div><div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{value ?? '—'}</div></div>;
}

export function IntlShipmentDetail() {
  const { idOrJob } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [charge, setCharge] = useState({ code: 'FREIGHT', name: '', amount: '', currency: '', taxable: false });

  const load = () => { setErr(''); api.intlGet(idOrJob!).then((r) => { setD(r); setCharge((c) => ({ ...c, currency: c.currency || r.currency || 'USD' })); }).catch((e) => setErr(e.message)); };
  useEffect(load, [idOrJob]);

  if (!d) return <div className="card">{err ? <div className="error">{err}</div> : 'Loading…'}</div>;
  const ocean = d.mode === 'OCEAN_FCL' || d.mode === 'OCEAN_LCL';
  const chargesTotal = (d.charges || []).reduce((n: number, c: any) => n + Number(c.amount || 0), 0);

  const setStatus = async (s: string) => { try { await api.intlSetStatus(d.id, s); setMsg(`Status → ${s}`); load(); } catch (e: any) { setErr(e.message); } };
  const addCharge = async () => {
    if (!(Number(charge.amount) !== 0)) { setErr('Enter a charge amount.'); return; }
    setErr('');
    try { await api.intlAddCharge(d.id, { code: charge.code, name: charge.name || charge.code, amount: Number(charge.amount), currency: charge.currency || d.currency, taxable: charge.taxable }); setCharge((c) => ({ ...c, name: '', amount: '' })); load(); }
    catch (e: any) { setErr(e.message); }
  };
  const delCharge = async (id: string) => { try { await api.intlDeleteCharge(id); load(); } catch (e: any) { setErr(e.message); } };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}>🌍 {d.jobNo} <span className="badge" style={{ marginLeft: 8 }}>{d.mode}</span> <span className={`badge ${d.status}`}>{d.status}</span></h1>
        <div className="row" style={{ gap: 8 }}>
          <Link to={`/intl/${d.jobNo}/document`}><button className="secondary">🧾 Commercial Invoice</button></Link>
          <Link to="/intl"><button className="secondary">← All jobs</button></Link>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)' }}>{msg}</div>}

      <div className="card">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>Set status:</span>
          {STATUSES.map((s) => <button key={s} className={d.status === s ? '' : 'secondary'} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setStatus(s)}>{s}</button>)}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Job details</h2>
        <div className="grid cols-4" style={{ gap: 16, rowGap: 16 }}>
          <F label="Customer" value={d.client?.legalName} />
          <F label="Direction" value={d.direction} />
          <F label="Incoterm" value={d.incoterm} />
          <F label="Service" value={d.serviceLevel} />
          <F label="Lane" value={`${d.originCountry || '—'} → ${d.destCountry || '—'}`} />
          <F label={ocean ? 'Origin → Dest port' : 'Origin → Dest'} value={`${d.originPort || '—'} → ${d.destPort || '—'}`} />
          <F label={ocean ? 'Shipping line' : 'Carrier'} value={d.carrier} />
          <F label={ocean ? 'HBL / MBL' : 'HAWB / MAWB'} value={`${d.houseNo || '—'} / ${d.masterNo || '—'}`} />
          {ocean && <F label="Container" value={`${d.containerNo || '—'} ${d.containerType || ''}`} />}
          {ocean && <F label="Vessel / Voyage" value={d.vesselVoyage} />}
          <F label="Pieces" value={d.packages} />
          <F label="Gross / Chargeable" value={`${d.grossWeightKg ?? 0} kg${d.chargeableWeightKg ? ` / ${d.chargeableWeightKg} kg` : ''}`} />
          <F label="Volume" value={d.volumeCbm ? `${d.volumeCbm} CBM` : '—'} />
          <F label="Declared value" value={d.declaredValue != null ? `${d.currency} ${Number(d.declaredValue).toLocaleString()}` : '—'} />
          <F label="HS code" value={d.hsCode} />
          <F label="Goods" value={d.goodsDesc} />
          <F label="ETD → ETA" value={`${d.etd ? fmtDate(d.etd) : '—'} → ${d.eta ? fmtDate(d.eta) : '—'}`} />
        </div>
        <div className="grid cols-2" style={{ gap: 16, marginTop: 14 }}>
          <div className="card" style={{ margin: 0 }}><h3 style={{ marginTop: 0 }}>Shipper</h3><div style={{ fontSize: 13 }}>{d.shipperName || '—'}<br />{d.shipperAddress}<br />{[d.shipperCity, d.shipperCountry].filter(Boolean).join(', ')}<br />{d.shipperContact}</div></div>
          <div className="card" style={{ margin: 0 }}><h3 style={{ marginTop: 0 }}>Consignee</h3><div style={{ fontSize: 13 }}>{d.consigneeName || '—'}<br />{d.consigneeAddress}<br />{[d.consigneeCity, d.consigneeCountry].filter(Boolean).join(', ')}<br />{d.consigneeContact}</div></div>
        </div>
      </div>

      {d.pieces?.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Packages</h2>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>Pcs</th><th>L×W×H (cm)</th><th>Weight kg</th><th>Description</th></tr></thead>
            <tbody>{d.pieces.map((p: any) => <tr key={p.id}><td>{p.count}</td><td>{[p.lengthCm, p.widthCm, p.heightCm].filter((x) => x != null).join('×') || '—'}</td><td>{p.weightKg ?? '—'}</td><td>{p.description || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Charges / billing</h2>
        {d.charges?.length > 0 && (
          <table style={{ fontSize: 13, marginBottom: 10 }}>
            <thead><tr><th>Code</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th><th>Taxable</th><th></th></tr></thead>
            <tbody>
              {d.charges.map((c: any) => (
                <tr key={c.id}><td>{c.code}</td><td>{c.name}</td><td style={{ textAlign: 'right' }}>{c.currency} {Number(c.amount).toLocaleString()}</td><td>{c.taxable ? 'Yes' : 'No'}</td>
                  <td><button className="secondary" style={{ padding: '2px 8px' }} onClick={() => delCharge(c.id)}>🗑</button></td></tr>
              ))}
              <tr><td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{d.currency} {chargesTotal.toLocaleString()}</td><td colSpan={2}></td></tr>
            </tbody>
          </table>
        )}
        <div className="grid cols-4" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div><label>Code</label><select value={charge.code} onChange={(e) => setCharge((c) => ({ ...c, code: e.target.value }))}>{CHARGE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label>Description</label><input value={charge.name} onChange={(e) => setCharge((c) => ({ ...c, name: e.target.value }))} placeholder="optional" /></div>
          <div><label>Amount ({charge.currency || d.currency})</label><input type="number" value={charge.amount} onChange={(e) => setCharge((c) => ({ ...c, amount: e.target.value }))} /></div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <label className="row" style={{ gap: 4, fontSize: 13, margin: 0 }}><input type="checkbox" checked={charge.taxable} onChange={(e) => setCharge((c) => ({ ...c, taxable: e.target.checked }))} style={{ width: 'auto' }} />Tax</label>
            <button onClick={addCharge}>＋ Add</button>
          </div>
        </div>
      </div>
    </>
  );
}
