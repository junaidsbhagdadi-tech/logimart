import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

/**
 * Rate calculator. Staff: every vendor's cost (fully priced from its own rate card), lowest first, with transit
 * time + on-time % from our delivery history, and — when a customer is picked — that customer's contract
 * price and our margin. Customer portal (only when enabled on the account): their contract carriers +
 * products, their agreed price with the full breakdown.
 */
type Box = { count: string; kg: string; l: string; w: string; h: string };
const blank = (): Box => ({ count: '1', kg: '', l: '', w: '', h: '' });
const inr = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PIN = /^\d{6}$/;

function Breakup({ p, title }: { p: any; title?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 3, fontSize: 13, background: 'var(--bg-soft, #f2f6f5)', borderRadius: 8, padding: '10px 12px' }}>
      {title && <b style={{ gridColumn: '1 / -1', marginBottom: 2 }}>{title}</b>}
      <span className="muted">Chargeable weight</span><span>{p.chargeableKg} kg</span>
      {p.lines.map((l: any, i: number) => <Fragment key={i}><span className="muted">{l.head}</span><span>{inr(l.amount)}</span></Fragment>)}
      <span style={{ fontWeight: 700 }}>Total excl. GST</span><span style={{ fontWeight: 700 }}>{inr(p.subtotal)}</span>
      <span className="muted">GST 18%</span><span>{inr(p.gst)}</span>
      <span style={{ fontWeight: 800 }}>Total</span><span style={{ fontWeight: 800 }}>{inr(p.total)}</span>
      {p.collectOnDelivery > 0 && <><span className="muted">Freight collected from consignee (FOD)</span><span>{inr(p.collectOnDelivery)}</span></>}
    </div>
  );
}

export function RateCalculator() {
  const { user } = useAuth();
  const isClient = user?.role === 'CLIENT_ADMIN';
  const [products, setProducts] = useState<{ code: string; name: string }[]>([]);
  const [carriers, setCarriers] = useState<{ code: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; accountCode: string; legalName: string }[]>([]);
  const [f, setF] = useState({ originPincode: '', destPincode: '', product: '', vendor: '', clientId: '', paymentTerm: 'PREPAID', invoiceValue: '', docType: 'NDOX', isDod: false, dodAmount: '', apptDelivery: false });
  const [boxes, setBoxes] = useState<Box[]>([blank()]);
  const [cities, setCities] = useState<{ o: string; d: string }>({ o: '', d: '' });
  const [res, setRes] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [blocked, setBlocked] = useState('');
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (isClient) {
      api.portalRateOptions().then((o) => { setProducts(o.products); setCarriers(o.carriers); if (o.carriers.length === 1) set('vendor', o.carriers[0].code); }).catch((e) => setBlocked(e.message));
    } else {
      api.listMaster('PRODUCT').then((r) => setProducts(r.filter((x: any) => x.active !== false).map((x: any) => ({ code: x.code, name: x.name })))).catch(() => {});
      api.bookingCustomers().then((cs: any[]) => setCustomers(cs.map((c) => ({ id: String(c.id), accountCode: c.accountCode, legalName: c.legalName })))).catch(() => {});
    }
  }, [isClient]);
  useEffect(() => { if (f.product.toUpperCase() === 'DOD') set('isDod', true); }, [f.product]);

  const look = (k: 'o' | 'd', pin: string) => {
    set(k === 'o' ? 'originPincode' : 'destPincode', pin);
    setCities((c) => ({ ...c, [k]: '' }));
    if (PIN.test(pin)) api.lookupPincode(pin).then((i: any) => setCities((c) => ({ ...c, [k]: i?.known === false ? 'Not in the pincode master' : [i?.cityName || i?.city, i?.state].filter(Boolean).join(', ') + (k === 'd' && i?.isOda ? ' · ODA' : '') }))).catch(() => {});
  };

  const missing = useMemo(() => [
    !PIN.test(f.originPincode) && 'origin pincode', !PIN.test(f.destPincode) && 'destination pincode', !f.product && 'product',
    isClient && !f.vendor && 'carrier', boxes.some((b) => !(Number(b.kg) > 0)) && 'weight of every box', f.isDod && !(Number(f.dodAmount) > 0) && 'DOD amount',
  ].filter(Boolean) as string[], [f, boxes, isClient]);

  const calc = async () => {
    if (missing.length) { setErr(`Needed: ${missing.join(', ')}`); return; }
    setBusy(true); setErr(''); setRes(null); setOpen(null);
    const body = {
      originPincode: f.originPincode, destPincode: f.destPincode, product: f.product, paymentTerm: f.paymentTerm, docType: f.docType,
      invoiceValue: Number(f.invoiceValue) || 0, isDod: f.isDod, dodAmount: f.isDod ? Number(f.dodAmount) : undefined, apptDelivery: f.apptDelivery,
      boxes: boxes.map((b) => ({ count: Number(b.count) || 1, kg: Number(b.kg), l: Number(b.l) || 0, w: Number(b.w) || 0, h: Number(b.h) || 0 })),
      ...(isClient ? { vendor: f.vendor } : { clientId: f.clientId || undefined }),
    };
    try { setRes(isClient ? await api.portalRateCalc(body) : await api.rateCalc(body)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (blocked) return (<><h1>💹 Rate Calculator</h1><div className="card">{blocked}</div></>);

  const tagStyle = (t: string) => ({ Lowest: { background: 'var(--st-done-bg)', color: 'var(--st-done-fg)' }, Fastest: { background: 'var(--st-moving-bg)', color: 'var(--st-moving-fg)' }, 'Most reliable': { background: 'var(--st-ofd-bg)', color: 'var(--st-ofd-fg)' } } as any)[t];
  const onTime = (r: any) => (r.onTimePct == null ? <span className="muted">—</span> : <>{r.onTimePct}% <span className="muted" style={{ fontSize: 11.5 }}>({r.measured}{r.statScope === 'vendor' ? ', all lanes' : ''})</span></>);

  return (
    <>
      <h1>💹 Rate Calculator</h1>
      <p className="muted" style={{ marginTop: -6 }}>{isClient ? 'Your contract rates — choose the carrier and enter the shipment.' : "Every vendor's cost from its own rate card, lowest first, with transit time and on-time delivery from our last 90 days. Pick a customer to see their contract price and our margin."}</p>
      {err && <div className="error">{err}</div>}
      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <div><label>Origin pincode *</label><input inputMode="numeric" maxLength={6} value={f.originPincode} onChange={(e) => look('o', e.target.value.trim())} />{cities.o && <div className="muted" style={{ fontSize: 12 }}>{cities.o}</div>}</div>
          <div><label>Destination pincode *</label><input inputMode="numeric" maxLength={6} value={f.destPincode} onChange={(e) => look('d', e.target.value.trim())} />{cities.d && <div className="muted" style={{ fontSize: 12 }}>{cities.d}</div>}</div>
          <div><label>Product *</label><select value={f.product} onChange={(e) => set('product', e.target.value)}><option value="">— select —</option>{products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select></div>
          {isClient
            ? <div><label>Carrier *</label><select value={f.vendor} onChange={(e) => set('vendor', e.target.value)}><option value="">— select —</option>{carriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
            : <div><label>Customer (optional)</label><select value={f.clientId} onChange={(e) => set('clientId', e.target.value)}><option value="">— vendor cost only —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}</select></div>}
          <div><label>Payment</label><select value={f.paymentTerm} onChange={(e) => set('paymentTerm', e.target.value)}><option value="PREPAID">Prepaid</option><option value="TO_PAY">To-pay</option></select></div>
          <div><label>Invoice value ₹ <span className="muted">(FOV)</span></label><input type="number" value={f.invoiceValue} onChange={(e) => set('invoiceValue', e.target.value)} /></div>
          <div><label>Parcel / document</label><select value={f.docType} onChange={(e) => set('docType', e.target.value)}><option value="NDOX">Parcel</option><option value="DOX">Document</option></select></div>
        </div>
        <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <label className="row" style={{ gap: 6, alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={f.isDod} onChange={(e) => set('isDod', e.target.checked)} /> DOD — cheque / DD on delivery</label>
          {f.isDod && <input type="number" placeholder="DOD amount ₹" value={f.dodAmount} onChange={(e) => set('dodAmount', e.target.value)} style={{ width: 160 }} />}
          <label className="row" style={{ gap: 6, alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={f.apptDelivery} onChange={(e) => set('apptDelivery', e.target.checked)} /> Appointment delivery</label>
        </div>
        <h3 style={{ margin: '16px 0 6px', fontSize: 14 }}>Boxes — weight and size of each box</h3>
        <table style={{ maxWidth: 620 }}>
          <thead><tr><th>Boxes</th><th>Kg each *</th><th>L cm</th><th>W cm</th><th>H cm</th><th></th></tr></thead>
          <tbody>
            {boxes.map((b, i) => (
              <tr key={i}>
                {(['count', 'kg', 'l', 'w', 'h'] as const).map((k) => <td key={k}><input type="number" inputMode="decimal" value={b[k]} style={{ width: k === 'count' ? 64 : 90 }} onChange={(e) => setBoxes((bs) => bs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>)}
                <td>{boxes.length > 1 && <button className="secondary" style={{ padding: '4px 8px' }} onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
          <button className="secondary" style={{ padding: '4px 12px', fontSize: 12.5 }} onClick={() => setBoxes((bs) => [...bs, blank()])}>＋ Another box size</button>
          <button onClick={calc} disabled={busy}>{busy ? 'Calculating…' : isClient ? 'Get rate' : 'Calculate'}</button>
        </div>
      </div>

      {res && !isClient && (
        <div className="card">
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            {res.route.origin.city || res.route.origin.pincode} → {res.route.dest.city || res.route.dest.pincode}{res.route.dest.oda ? ' · ODA' : ''} · {res.product} · {res.weight.boxes} box(es) · {res.weight.deadKg} kg actual · {res.weight.volKg} kg volumetric ({res.weight.volRule})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Vendor</th><th style={{ textAlign: 'right' }}>Cost excl. GST</th><th style={{ textAlign: 'right' }}>With GST</th><th>Transit</th><th>On time</th>{res.rows.some((r: any) => r.customer) && <><th style={{ textAlign: 'right' }}>Customer price</th><th style={{ textAlign: 'right' }}>Margin</th></>}<th></th></tr></thead>
              <tbody>
                {res.rows.map((r: any) => (
                  <Fragment key={r.vendor}>
                    <tr style={{ cursor: r.cost ? 'pointer' : undefined, opacity: r.cost ? 1 : 0.6 }} onClick={() => r.cost && setOpen(open === r.vendor ? null : r.vendor)}>
                      <td><b>{r.vendor}</b> <span className="muted">{r.name !== r.vendor ? r.name : ''}</span>{r.oda && <span className="badge" style={{ marginLeft: 6, background: 'var(--st-ofd-bg)', color: 'var(--st-ofd-fg)' }}>ODA</span>}{r.tags.map((t: string) => <span key={t} className="badge" style={{ marginLeft: 6, ...tagStyle(t) }}>{t}</span>)}</td>
                      <td style={{ textAlign: 'right' }}>{r.cost ? inr(r.cost.subtotal) : <span className="muted">{r.status}</span>}</td>
                      <td style={{ textAlign: 'right' }}>{r.cost ? inr(r.cost.total) : ''}</td>
                      <td>{r.transitDays ? `${r.transitDays} day${r.transitDays === 1 ? '' : 's'}` : '—'}{r.transitSource === 'pincode master' && <span className="muted" style={{ fontSize: 11.5 }}> (master)</span>}</td>
                      <td>{onTime(r)}</td>
                      {res.rows.some((x: any) => x.customer) && <>
                        <td style={{ textAlign: 'right' }}>{r.customer ? inr(r.customer.subtotal) : <span className="muted">no contract rate</span>}</td>
                        <td style={{ textAlign: 'right', color: r.customer?.margin < 0 ? 'var(--bad)' : undefined }}>{r.customer?.margin != null ? `${inr(r.customer.margin)} (${r.customer.marginPct}%)` : '—'}</td>
                      </>}
                      <td>{r.cost ? (open === r.vendor ? '▲' : '▼') : ''}</td>
                    </tr>
                    {open === r.vendor && (
                      <tr><td colSpan={8}>
                        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                          <Breakup p={r.cost} title={`${r.vendor} — our cost`} />
                          {r.customer && <Breakup p={r.customer} title="Customer contract price" />}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {res.rows.length === 0 && <p className="muted">No vendor has a rate card or recent deliveries for {res.product}.</p>}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Click a priced row for the full breakdown. On time = delivered by the promised date, last 90 days, same vendor · product · destination zone (all lanes when fewer than 20). "No rate card" = upload that vendor's cost card to price it.</p>
        </div>
      )}

      {res && isClient && (
        <div className="card">
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{res.route.origin.city || res.route.origin.pincode} → {res.route.dest.city || res.route.dest.pincode}{res.oda ? ' · ODA' : ''} · {res.weight.boxes} box(es)</div>
          {res.message ? <p>{res.message}</p> : (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div className="card" style={{ margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>Total (incl. GST)</div><div style={{ fontSize: 24, fontWeight: 800 }}>{inr(res.price.total)}</div></div>
                <div className="card" style={{ margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>Transit time</div><div style={{ fontSize: 24, fontWeight: 800 }}>{res.transitDays ? `${res.transitDays} days` : '—'}</div></div>
                <div className="card" style={{ margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>Delivered on time</div><div style={{ fontSize: 24, fontWeight: 800 }}>{res.onTimePct != null ? `${res.onTimePct}%` : '—'}</div></div>
              </div>
              <Breakup p={res.price} />
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Your agreed contract rate. Final billing follows the actual weight and dimensions at pickup.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
