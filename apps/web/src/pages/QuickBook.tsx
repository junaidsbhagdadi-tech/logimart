import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ScanButton } from '../components/BarcodeScanner';

/**
 * Quick booking — the phone-first booking screen (eShipz-style): only what's needed to book, with
 * barcode scanning for AWB / forwarding no / reference / invoice / e-way bill / GST. Parcel or Document.
 * Customer code bills the right account; the pickup address defaults to the customer's own address
 * (change it only when picking up elsewhere). Same booking API as the full New Shipment form.
 */

type Cust = { id: string; accountCode: string; legalName: string; addressLine?: string | null; city?: string | null; state?: string | null; pincode?: string | null; contactPhone?: string | null; contactName?: string | null; defaultVendor?: string | null };
type Box = { nos: string; l: string; w: string; h: string; kg: string };
type Settings = { prefillPhone: boolean; prefillContent: boolean; docDefault: boolean; autoRef: boolean; totalWeight: boolean };

const SETTINGS_KEY = 'lm_quickbook_settings';
const LAST_CONTENT_KEY = 'lm_quickbook_content';
const DEFAULTS: Settings = { prefillPhone: false, prefillContent: true, docDefault: false, autoRef: false, totalWeight: true };
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* private mode */ } };
const blankBox = (): Box => ({ nos: '1', l: '', w: '', h: '', kg: '' });
// Defined at module level (not inside QuickBook) so inputs keep focus while typing.
const Field = ({ label, children }: { label: string; children: any }) => <div style={{ marginBottom: 10 }}><label style={{ fontSize: 12 }}>{label}</label>{children}</div>;

export function QuickBook() {
  const [st, setSt] = useState<Settings>(() => load(SETTINGS_KEY, DEFAULTS));
  const [showSettings, setShowSettings] = useState(false);
  const setSetting = (k: keyof Settings, v: boolean) => setSt((s) => { const n = { ...s, [k]: v }; save(SETTINGS_KEY, n); return n; });

  const [docType, setDocType] = useState<'NDOX' | 'DOX'>(() => (load(SETTINGS_KEY, DEFAULTS).docDefault ? 'DOX' : 'NDOX'));
  const [customers, setCustomers] = useState<Cust[]>([]);
  const [custText, setCustText] = useState('');
  const [cust, setCust] = useState<Cust | null>(null);
  const [products, setProducts] = useState<{ code: string; name: string; surface: boolean }[]>([]);
  const [vendors, setVendors] = useState<{ code: string; name: string }[]>([]);
  const [product, setProduct] = useState('');
  const [vendor, setVendor] = useState('');
  const [fmPickup, setFmPickup] = useState('pickup'); // Delhivery first mile: pickup (default) / drop
  const [ref, setRef] = useState('');
  const [content, setContent] = useState(() => { try { return localStorage.getItem(LAST_CONTENT_KEY) || ''; } catch { return ''; } });
  const [awb, setAwb] = useState('');
  const [fwd, setFwd] = useState('');
  const [invNo, setInvNo] = useState('');
  const [invAmt, setInvAmt] = useState('');
  const [ewb, setEwb] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([blankBox()]);
  const [totalKg, setTotalKg] = useState('');
  const [pickupElsewhere, setPickupElsewhere] = useState(false);
  const [pick, setPick] = useState({ address: '', pincode: '', phone: '' });
  const [con, setCon] = useState({ name: '', phone: '', address: '', pincode: '', gst: '' });
  const [destCity, setDestCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [booked, setBooked] = useState<{ awb: string; vendor: string } | null>(null);

  useEffect(() => {
    api.bookingCustomers().then((cs: any[]) => setCustomers(cs)).catch(() => {});
    api.listMaster('PRODUCT').then((r) => setProducts(r.filter((x) => x.active !== false).map((x) => {
      const a: any = x.attrs || {};
      const mode = String(a.service || a.mode || a.serviceMode || a.groupType || '');
      return { code: x.code, name: x.name, surface: /SURF|ROAD|RAIL/i.test(mode) || /SFC|SURFACE|ROAD|RAIL|HUB/i.test(x.code) };
    }))).catch(() => {});
    api.listVendors().then((v: any[]) => setVendors(v.filter((x) => x.isActive !== false).map((x) => ({ code: x.vendorCode, name: x.name })))).catch(() => {});
  }, []);
  useEffect(() => { if (st.prefillPhone && !con.phone) setCon((c) => ({ ...c, phone: '0000000000' })); /* eslint-disable-next-line */ }, [st.prefillPhone]);
  useEffect(() => { if (st.autoRef && !ref) setRef(`R${Date.now().toString().slice(-8)}`); /* eslint-disable-next-line */ }, [st.autoRef, booked]);

  // Customer: type the code (or name) — matched on exact code first, then "CODE — NAME" from the list.
  const pickCustomer = (v: string) => {
    setCustText(v);
    const s = v.trim().toLowerCase();
    const m = customers.find((c) => c.accountCode.toLowerCase() === s || `${c.accountCode} — ${c.legalName}`.toLowerCase() === s);
    setCust(m ?? null);
    if (m?.defaultVendor && !vendor) setVendor(String(m.defaultVendor).toUpperCase());
  };
  // Carrier suggestion for this customer × product × destination: serviceable first, then cheapest.
  const [sugg, setSugg] = useState<{ vendor: string; name: string; price: number | null; serviceable: boolean | null; tatDays: number | null }[]>([]);
  useEffect(() => {
    setSugg([]);
    if (!cust || !product || !/^\d{6}$/.test(con.pincode)) return;
    const t = setTimeout(() => {
      api.carrierSuggest({ clientId: Number(cust.id), product, originPincode: (pickupElsewhere ? pick.pincode : cust.pincode) || undefined, destPincode: con.pincode, deadKg: Number(totalKg) || undefined })
        .then((r) => setSugg(r.carriers.slice(0, 6))).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cust?.id, product, con.pincode]);
  const lookDest = (p: string) => {
    setCon((c) => ({ ...c, pincode: p }));
    setDestCity('');
    if (/^\d{6}$/.test(p)) api.lookupPincode(p).then((i: any) => setDestCity(i?.known === false ? '⚠ not in the pincode master' : [i?.city, i?.state].filter(Boolean).join(', '))).catch(() => {});
  };

  const totalBoxes = boxes.reduce((s, b) => s + Math.max(1, Math.floor(Number(b.nos) || 1)), 0);
  const kgSum = st.totalWeight ? Number(totalKg) || 0 : boxes.reduce((s, b) => s + (Number(b.kg) || 0) * Math.max(1, Math.floor(Number(b.nos) || 1)), 0);
  const needEway = Number(invAmt) >= 50000;
  const sel = products.find((p) => p.code === product);
  const originPin = pickupElsewhere ? pick.pincode : (cust?.pincode ?? '');
  const ready = !!cust && !!product && /^\d{6}$/.test(con.pincode) && kgSum > 0 && !!con.name && (!pickupElsewhere || (!!pick.address && /^\d{6}$/.test(pick.pincode)));
  const missing = useMemo(() => [
    !cust && 'customer', !product && 'product', !/^\d{6}$/.test(con.pincode) && 'consignee pincode', !con.name && 'consignee name', !(kgSum > 0) && 'weight',
    pickupElsewhere && !pick.address && 'pickup address', pickupElsewhere && !/^\d{6}$/.test(pick.pincode) && 'pickup pincode',
  ].filter(Boolean) as string[], [cust, product, con, kgSum, pickupElsewhere, pick]);

  const book = async () => {
    if (!ready || !cust) return;
    setBusy(true); setErr('');
    try {
      const perBoxKg = st.totalWeight ? +(kgSum / totalBoxes).toFixed(3) : 0;
      const pieces = boxes.flatMap((b) => Array.from({ length: Math.max(1, Math.floor(Number(b.nos) || 1)) }, () => ({
        deadKg: st.totalWeight ? perBoxKg : Number(b.kg) || 0.5,
        lengthCm: b.l ? +b.l : undefined, widthCm: b.w ? +b.w : undefined, heightCm: b.h ? +b.h : undefined,
      })));
      const res = await api.createShipment({
        clientId: Number(cust.id), product, docType, serviceMode: sel?.surface ? 'ROAD_PTL' : 'AIR_EXPRESS',
        originZone: 'SOUTH', destZone: 'SOUTH', // re-derived server-side from the pincodes
        originPincode: originPin || undefined, destPincode: con.pincode,
        shipperName: cust.legalName, shipperContact: cust.contactName || undefined,
        shipperAddress1: pickupElsewhere ? pick.address : (cust.addressLine || undefined),
        shipperPincode: originPin || undefined, shipperCity: pickupElsewhere ? undefined : (cust.city || undefined),
        shipperMobile: (pickupElsewhere ? pick.phone : cust.contactPhone) || undefined,
        consigneeName: con.name, consigneePhone: con.phone || undefined, consigneeAddress: con.address || undefined, consigneeGstin: con.gst || undefined,
        vendor: vendor || undefined, forwardingAwb: fwd.trim() || undefined, manualAwb: awb.trim() || undefined,
        fmPickup: /^DLY|DELHIVERY/i.test(vendor) ? fmPickup === 'pickup' : undefined,
        referenceNo: ref || undefined, goodsDesc: content || undefined,
        shipmentValue: invAmt ? +invAmt : undefined, declaredValue: invAmt ? +invAmt : undefined,
        invoiceNo: invNo || undefined, ewbNo: ewb || undefined,
        paymentTerm: 'PREPAID', pieces,
      } as any);
      if (st.prefillContent) save(LAST_CONTENT_KEY, content);
      setBooked({ awb: res.awb, vendor: vendor || 'SELF' });
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // Book the next one for the same customer/product/vendor — clear the per-shipment fields.
  const next = () => {
    setBooked(null); setErr(''); setAwb(''); setFwd(''); setInvNo(''); setInvAmt(''); setEwb(''); setTotalKg('');
    setBoxes([blankBox()]); setRef(''); setCon({ name: '', phone: st.prefillPhone ? '0000000000' : '', address: '', pincode: '', gst: '' }); setDestCity('');
    if (!st.prefillContent) setContent('');
  };

  const scanRow = (value: string, set: (v: string) => void, placeholder: string, title: string) => (
    <div className="row" style={{ gap: 6 }}><input style={{ flex: 1 }} value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} /><ScanButton title={title} onScan={set} /></div>
  );

  if (booked) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h2 style={{ margin: '6px 0' }}>Booked — {booked.awb}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{cust?.accountCode} — {cust?.legalName} · {booked.vendor}</p>
          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={`/shipments/${booked.awb}/labels`}><button>🏷 Print label</button></Link>
            <Link to={`/handover?vendor=${encodeURIComponent(booked.vendor)}`}><button className="secondary">📋 Handover manifest</button></Link>
            <button className="secondary" onClick={next}>➕ Book next</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', paddingBottom: 80 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>⚡ Quick booking</h1>
        <button className="secondary" style={{ padding: '4px 10px' }} onClick={() => setShowSettings((v) => !v)} title="Settings">⚙</button>
      </div>

      {showSettings && (
        <div className="card" style={{ padding: 12 }}>
          {([['prefillPhone', 'Pre-fill receiver phone (0000000000)'], ['prefillContent', 'Remember parcel content'], ['docDefault', 'Document as default'], ['autoRef', 'Auto customer reference'], ['totalWeight', 'One total weight (split across boxes)']] as const).map(([k, label]) => (
            <label key={k} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 400, padding: '4px 0' }}>
              {label}<input type="checkbox" checked={st[k]} onChange={(e) => setSetting(k, e.target.checked)} style={{ width: 'auto' }} />
            </label>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 0, margin: '10px 0' }}>
        {(['NDOX', 'DOX'] as const).map((t) => (
          <button key={t} className={docType === t ? '' : 'secondary'} style={{ flex: 1, borderRadius: t === 'NDOX' ? '10px 0 0 10px' : '0 10px 10px 0' }} onClick={() => setDocType(t)}>{t === 'NDOX' ? '📦 Parcel' : '📄 Document'}</button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      <div className="card" style={{ padding: 14 }}>
        <Field label="Customer code *">
          <input list="qb-customers" value={custText} onChange={(e) => pickCustomer(e.target.value)} placeholder="type the code, e.g. 111130" />
          <datalist id="qb-customers">{customers.map((c) => <option key={c.id} value={`${c.accountCode} — ${c.legalName}`} />)}</datalist>
          {cust && <div style={{ fontSize: 12.5, marginTop: 4 }}><strong>{cust.legalName}</strong></div>}
          {!cust && custText.trim() && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>No customer with that code yet — pick from the list.</div>}
        </Field>
        {cust && (
          <div style={{ fontSize: 12.5, marginTop: -4, marginBottom: 10, padding: '6px 8px', borderRadius: 8, background: 'var(--surface-2, #f1f3f6)' }}>
            {!pickupElsewhere
              ? <>Pickup: {[cust.addressLine, cust.city, cust.pincode].filter(Boolean).join(', ') || <span className="muted">no address on the customer — enter one below</span>}</>
              : <>Pickup from a different address:</>}
            <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 400, marginTop: 4 }}><input type="checkbox" checked={pickupElsewhere} onChange={(e) => setPickupElsewhere(e.target.checked)} style={{ width: 'auto' }} /> Pick up from a different address</label>
            {pickupElsewhere && (
              <div style={{ marginTop: 6 }}>
                <input value={pick.address} onChange={(e) => setPick((p) => ({ ...p, address: e.target.value }))} placeholder="Pickup address *" style={{ marginBottom: 6 }} />
                <div className="row" style={{ gap: 6 }}>
                  <input value={pick.pincode} maxLength={6} onChange={(e) => setPick((p) => ({ ...p, pincode: e.target.value }))} placeholder="Pincode *" />
                  <input value={pick.phone} onChange={(e) => setPick((p) => ({ ...p, phone: e.target.value }))} placeholder="Contact phone" />
                </div>
              </div>
            )}
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}><Field label="Product *">
            <select value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="">— select —</option>
              {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
          </Field></div>
          <div style={{ flex: 1 }}><Field label="Vendor">
            <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">SELF</option>
              {vendors.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
            </select>
          </Field></div>
          {/^DLY|DELHIVERY/i.test(vendor) && <div style={{ flex: 1 }}><Field label="Delhivery first mile">
            <select value={fmPickup} onChange={(e) => setFmPickup(e.target.value)}>
              <option value="pickup">Delhivery picks up from the pickup address</option>
              <option value="drop">Self-drop at Delhivery hub</option>
            </select>
          </Field></div>}
        </div>
        {sugg.length > 0 && (
          <div style={{ margin: '-4px 0 10px' }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Suggested carriers for {con.pincode} — tap to pick</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {sugg.map((c) => (
                <button key={c.vendor} type="button" className={vendor === c.vendor ? '' : 'secondary'} disabled={c.serviceable === false}
                  title={c.serviceable === false ? 'Not serviceable for this pincode' : c.name}
                  style={{ padding: '4px 10px', fontSize: 12, opacity: c.serviceable === false ? 0.5 : 1 }} onClick={() => setVendor(c.vendor)}>
                  <strong>{c.vendor}</strong>{c.price != null ? ` · ₹${Math.round(c.price).toLocaleString('en-IN')}` : ''}{c.tatDays != null ? ` · ${c.tatDays}d` : ''}{c.serviceable === false ? ' · ✗' : c.serviceable ? ' · ✓' : ''}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}><Field label="Reference">{scanRow(ref, setRef, 'customer ref', 'Scan the reference')}</Field></div>
          <div style={{ flex: 1 }}><Field label={docType === 'DOX' ? 'Content' : 'Parcel content'}><input value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. Cosmetics" /></Field></div>
        </div>
        <Field label="AWB (blank = auto)">{scanRow(awb, setAwb, 'scan or type the AWB', 'Scan the AWB barcode')}</Field>
        {vendor && <Field label="Forwarding no (vendor AWB)">{scanRow(fwd, setFwd, 'carrier AWB / LR', 'Scan the carrier barcode')}</Field>}
      </div>

      {docType === 'NDOX' && (
        <div className="card" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}><Field label="Invoice number">{scanRow(invNo, setInvNo, 'invoice no', 'Scan the invoice barcode')}</Field></div>
            <div style={{ flex: 1 }}><Field label="Invoice amount ₹"><input type="number" inputMode="decimal" value={invAmt} onChange={(e) => setInvAmt(e.target.value)} /></Field></div>
          </div>
          {(needEway || ewb) && <Field label={`E-way bill no${needEway ? ' (₹50,000+ — required; blank = flagged EWB pending)' : ''}`}>{scanRow(ewb, setEwb, '12-digit e-way bill', 'Scan the e-way bill barcode')}</Field>}
        </div>
      )}

      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 13 }}>Boxes ({totalBoxes})</strong>
          <button className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setBoxes((b) => [...b, blankBox()])}>+ size</button>
        </div>
        {boxes.map((b, i) => (
          <div key={i} className="row" style={{ gap: 4, marginTop: 6, alignItems: 'center' }}>
            <input style={{ width: 52 }} type="number" inputMode="numeric" value={b.nos} onChange={(e) => setBoxes((bs) => bs.map((x, j) => (j === i ? { ...x, nos: e.target.value } : x)))} title="Number of boxes" />
            <span className="muted">×</span>
            {(['l', 'w', 'h'] as const).map((k) => <input key={k} style={{ width: 60 }} type="number" inputMode="decimal" placeholder={k.toUpperCase() + ' cm'} value={b[k]} onChange={(e) => setBoxes((bs) => bs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
            {!st.totalWeight && <input style={{ width: 62 }} type="number" inputMode="decimal" placeholder="kg/box" value={b.kg} onChange={(e) => setBoxes((bs) => bs.map((x, j) => (j === i ? { ...x, kg: e.target.value } : x)))} />}
            {boxes.length > 1 && <button className="secondary" style={{ padding: '2px 8px' }} onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        {st.totalWeight
          ? <div style={{ marginTop: 10 }}><label style={{ fontSize: 12 }}>Total weight (kg) *</label><input type="number" inputMode="decimal" value={totalKg} onChange={(e) => setTotalKg(e.target.value)} /></div>
          : <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Total {kgSum.toFixed(2)} kg</div>}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <strong style={{ fontSize: 13 }}>Consignee</strong>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <div style={{ flex: 1 }}><Field label="Name *"><input value={con.name} onChange={(e) => setCon((c) => ({ ...c, name: e.target.value }))} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Phone"><input inputMode="tel" value={con.phone} onChange={(e) => setCon((c) => ({ ...c, phone: e.target.value }))} /></Field></div>
        </div>
        <Field label="Address"><input value={con.address} onChange={(e) => setCon((c) => ({ ...c, address: e.target.value }))} /></Field>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}><Field label="Pincode *"><input inputMode="numeric" maxLength={6} value={con.pincode} onChange={(e) => lookDest(e.target.value)} />{destCity && <div className="muted" style={{ fontSize: 11.5 }}>{destCity}</div>}</Field></div>
          <div style={{ flex: 1 }}><Field label="GST">{scanRow(con.gst, (v) => setCon((c) => ({ ...c, gst: v })), 'optional', 'Scan the GST barcode')}</Field></div>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '10px 0', background: 'var(--bg, #f6f8fa)' }}>
        <button style={{ width: '100%', padding: 14, fontSize: 15 }} disabled={!ready || busy} onClick={book}>{busy ? 'Booking…' : '📦 Book shipment'}</button>
        {!ready && missing.length > 0 && <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 4 }}>Needed: {missing.join(', ')}</div>}
      </div>
    </div>
  );
}
