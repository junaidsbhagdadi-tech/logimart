import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ScanButton } from '../components/BarcodeScanner';
import { StatusBadge } from '../components/StatusBadge';

/**
 * Quick booking — the same screen as the rider app's Book tab (swdev #8-7): "New booking" and
 * "My bookings", the same sections in the same order, invoice / e-way bill photos, and after booking
 * the same summary (edit, cancel, hand to carrier, attach invoice, print). Same booking API.
 */

type Cust = { id: string; accountCode: string; legalName: string; addressLine?: string | null; city?: string | null; state?: string | null; pincode?: string | null; contactPhone?: string | null; contactName?: string | null; defaultVendor?: string | null };
type Line = { nos: string; l: string; w: string; h: string };
type Settings = { prefillPhone: boolean; docDefault: boolean; autoRef: boolean };

const SETTINGS_KEY = 'lm_quickbook_settings';
const LAST_CONTENT_KEY = 'lm_quickbook_content';
const DEFAULTS: Settings = { prefillPhone: false, docDefault: false, autoRef: false };
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* private mode */ } };
const blankLine = (): Line => ({ nos: '1', l: '', w: '', h: '' });
const count = (l: Line) => Math.min(999, Math.max(1, Math.floor(Number(l.nos) || 1)));
const isDly = (v: string) => /^DLY|DELHIVERY/i.test(v);
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const fileToDataUrl = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(f); });

// Module level (not inside the component) so inputs keep focus while typing.
const Section = ({ children }: { children: any }) => <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted, #6b7280)', margin: '18px 0 6px' }}>{children}</div>;
const Field = ({ label, hint, children }: { label: string; hint?: string; children: any }) => <div style={{ marginBottom: 10, flex: 1 }}><label style={{ fontSize: 12 }}>{label}</label>{children}{hint && <div className="muted" style={{ fontSize: 11.5 }}>{hint}</div>}</div>;

export function QuickBook() {
  const [view, setView] = useState<'new' | 'mine'>('new');
  const [summaryAwb, setSummaryAwb] = useState<{ awb: string; justBooked: boolean } | null>(null);
  const [mineKey, setMineKey] = useState(0);

  if (summaryAwb) return <BookingSummary awb={summaryAwb.awb} justBooked={summaryAwb.justBooked} onClose={() => { setSummaryAwb(null); setMineKey((k) => k + 1); }} />;
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 80 }}>
      <h1 style={{ margin: '0 0 10px' }}>⚡ Quick booking</h1>
      <div className="row" style={{ gap: 0, marginBottom: 6 }}>
        {([['new', '＋ New booking'], ['mine', '☰ My bookings']] as const).map(([v, label], i) => (
          <button key={v} className={view === v ? '' : 'secondary'} style={{ flex: 1, borderRadius: i === 0 ? '10px 0 0 10px' : '0 10px 10px 0' }} onClick={() => { setView(v); if (v === 'mine') setMineKey((k) => k + 1); }}>{label}</button>
        ))}
      </div>
      {/* Keep the form mounted (like the app's IndexedStack) so switching tabs never loses a half-filled booking. */}
      <div style={{ display: view === 'new' ? 'block' : 'none' }}><NewBooking onBooked={(awb) => setSummaryAwb({ awb, justBooked: true })} /></div>
      {view === 'mine' && <MyBookings key={mineKey} onOpen={(awb) => setSummaryAwb({ awb, justBooked: false })} />}
    </div>
  );
}

function NewBooking({ onBooked }: { onBooked: (awb: string) => void }) {
  const [st, setSt] = useState<Settings>(() => load(SETTINGS_KEY, DEFAULTS));
  const [showSettings, setShowSettings] = useState(false);
  const setSetting = (k: keyof Settings, v: boolean) => setSt((s) => { const n = { ...s, [k]: v }; save(SETTINGS_KEY, n); return n; });

  const [customers, setCustomers] = useState<Cust[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string; surface: boolean }[]>([]);
  const [vendors, setVendors] = useState<{ code: string; name: string }[]>([]);
  const [custText, setCustText] = useState('');
  const [cust, setCust] = useState<Cust | null>(null);
  const [product, setProduct] = useState('');
  const [vendor, setVendor] = useState('');
  const [fmPickup, setFmPickup] = useState(true); // Delhivery first mile: Delhivery picks up (default) / self-drop
  const [docType, setDocType] = useState<'NDOX' | 'DOX'>(() => (load(SETTINGS_KEY, DEFAULTS).docDefault ? 'DOX' : 'NDOX'));
  const [pickupElsewhere, setPickupElsewhere] = useState(false);
  const [pick, setPick] = useState({ address: '', pincode: '', phone: '' });
  const [con, setCon] = useState({ name: '', pincode: '', phone: '', address: '', gst: '' });
  const [destCity, setDestCity] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [kg, setKg] = useState('');
  const [content, setContent] = useState(() => { try { return localStorage.getItem(LAST_CONTENT_KEY) || ''; } catch { return ''; } });
  const [awb, setAwb] = useState('');
  const [fwd, setFwd] = useState('');
  const [ref, setRef] = useState('');
  const [invNo, setInvNo] = useState('');
  const [invAmt, setInvAmt] = useState('');
  const [ewb, setEwb] = useState('');
  const [invDoc, setInvDoc] = useState<{ name: string; url: string } | null>(null);
  const [ewbDoc, setEwbDoc] = useState<{ name: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
  useEffect(() => { if (st.autoRef && !ref) setRef(`R${Date.now().toString().slice(-8)}`); /* eslint-disable-next-line */ }, [st.autoRef]);

  // Customer: type the code or name and pick from the list (the app's customer picker).
  const pickCustomer = (v: string) => {
    setCustText(v);
    const s = v.trim().toLowerCase();
    const m = customers.find((c) => c.accountCode.toLowerCase() === s || `${c.accountCode} — ${c.legalName}`.toLowerCase() === s);
    setCust(m ?? null);
    const dv = String(m?.defaultVendor || '').toUpperCase();
    if (dv && vendors.some((x) => x.code.toUpperCase() === dv)) setVendor(vendors.find((x) => x.code.toUpperCase() === dv)!.code);
  };
  const lookDest = (p: string) => {
    setCon((c) => ({ ...c, pincode: p }));
    setDestCity('');
    if (/^\d{6}$/.test(p)) api.lookupPincode(p).then((i: any) => setDestCity(i?.known === false ? 'Not in the pincode master' : [i?.city, i?.state].filter(Boolean).join(', '))).catch(() => {});
  };

  // Carrier suggestion for this customer × product × destination (serviceable first, then cheapest).
  const [sugg, setSugg] = useState<{ vendor: string; name: string; price: number | null; serviceable: boolean | null; tatDays: number | null }[]>([]);
  useEffect(() => {
    setSugg([]);
    if (!cust || !product || !/^\d{6}$/.test(con.pincode)) return;
    const t = setTimeout(() => {
      api.carrierSuggest({ clientId: Number(cust.id), product, originPincode: (pickupElsewhere ? pick.pincode : cust.pincode) || undefined, destPincode: con.pincode, deadKg: Number(kg) || undefined })
        .then((r) => setSugg(r.carriers.slice(0, 6))).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cust?.id, product, con.pincode]);

  const boxes = lines.reduce((s, l) => s + count(l), 0);
  const needEway = Number(invAmt) >= 50000;
  const missing = useMemo(() => [
    !cust && 'customer', !product && 'product', !/^\d{6}$/.test(con.pincode.trim()) && 'consignee pincode', !con.name.trim() && 'consignee name',
    !(Number(kg) > 0) && 'weight', pickupElsewhere && !pick.address.trim() && 'pickup address', pickupElsewhere && !/^\d{6}$/.test(pick.pincode.trim()) && 'pickup pincode',
  ].filter(Boolean) as string[], [cust, product, con, kg, pickupElsewhere, pick]);

  const book = async () => {
    if (missing.length) { setErr(`Missing: ${missing.join(', ')}`); return; }
    const c = cust!;
    const sel = products.find((p) => p.code === product);
    const perBox = +(Number(kg) / boxes).toFixed(3);
    const originPin = pickupElsewhere ? pick.pincode.trim() : (c.pincode ?? '');
    const inv = Number(invAmt) > 0 ? Number(invAmt) : undefined;
    const opt = (v: string) => v.trim() || undefined;
    setBusy(true); setErr('');
    try {
      const res = await api.createShipment({
        clientId: Number(c.id), product, docType, serviceMode: sel?.surface ? 'ROAD_PTL' : 'AIR_EXPRESS',
        originZone: 'SOUTH', destZone: 'SOUTH', // re-derived server-side from the pincodes
        originPincode: originPin || undefined, destPincode: con.pincode.trim(),
        shipperName: c.legalName, shipperContact: c.contactName || undefined,
        shipperAddress1: pickupElsewhere ? pick.address.trim() : (c.addressLine || undefined),
        shipperPincode: originPin || undefined, shipperCity: pickupElsewhere ? undefined : (c.city || undefined),
        shipperMobile: (pickupElsewhere ? opt(pick.phone) : c.contactPhone) || undefined,
        consigneeName: con.name.trim(), consigneePhone: opt(con.phone), consigneeAddress: opt(con.address), consigneeGstin: opt(con.gst),
        vendor: vendor || undefined, fmPickup: isDly(vendor) ? fmPickup : undefined,
        forwardingAwb: opt(fwd)?.toUpperCase(), manualAwb: opt(awb)?.toUpperCase(), referenceNo: opt(ref), goodsDesc: opt(content),
        shipmentValue: inv, declaredValue: inv, invoiceNo: opt(invNo), ewbNo: opt(ewb),
        paymentTerm: 'PREPAID',
        // One piece per box, each carrying its line's size (volumetric weight is worked out server-side).
        pieces: lines.flatMap((l) => Array.from({ length: count(l) }, () => ({ deadKg: perBox, lengthCm: Number(l.l) > 0 ? +l.l : undefined, widthCm: Number(l.w) > 0 ? +l.w : undefined, heightCm: Number(l.h) > 0 ? +l.h : undefined }))),
      } as any);
      // Attach the invoice / e-way bill photos to the new AWB (a failed upload never undoes the booking).
      const failed: string[] = [];
      for (const [doc, docType, label] of [[invDoc, 'invoice', 'Invoice copy'], [ewbDoc, 'ewaybill', 'E-way bill']] as const) {
        if (doc) await api.attachShipmentDoc(res.awb, doc.url, docType, label).catch(() => failed.push(label));
      }
      save(LAST_CONTENT_KEY, content.trim());
      if (failed.length) alert(`Booked, but the ${failed.join(' and ')} upload failed — attach it again from the summary.`);
      next();
      onBooked(res.awb);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // Book the next one for the same customer / product / carrier — clear the per-shipment fields.
  const next = () => {
    setCon({ name: '', pincode: '', phone: st.prefillPhone ? '0000000000' : '', address: '', gst: '' }); setDestCity('');
    setKg(''); setAwb(''); setFwd(''); setRef(st.autoRef ? `R${Date.now().toString().slice(-8)}` : ''); setInvNo(''); setInvAmt(''); setEwb('');
    setLines([blankLine()]); setInvDoc(null); setEwbDoc(null);
  };

  const scan = (value: string, set: (v: string) => void, placeholder: string, title: string) => (
    <div className="row" style={{ gap: 6 }}><input style={{ flex: 1 }} value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} /><ScanButton title={title} onScan={set} /></div>
  );
  const docButton = (what: string, doc: { name: string } | null, set: (d: { name: string; url: string } | null) => void) => (
    doc
      ? <button type="button" className="secondary" style={{ flex: 1, padding: 12 }} onClick={() => set(null)} title="Remove">✅ {what} ✓ (click to remove)</button>
      : <label className="button secondary" style={{ flex: 1, padding: 12, textAlign: 'center', cursor: 'pointer', border: '1px solid var(--border, #d0d5dd)', borderRadius: 8, fontWeight: 600 }}>
          📷 {what} photo
          <input type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }} onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            if (f.size > 8 * 1024 * 1024) { setErr(`${what} file is over 8 MB — take a smaller photo.`); return; }
            set({ name: f.name, url: await fileToDataUrl(f) });
          }} />
        </label>
  );

  return (
    <>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: -4 }}>
        <button className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setShowSettings((v) => !v)} title="Settings">⚙ Settings</button>
      </div>
      {showSettings && (
        <div className="card" style={{ padding: 12 }}>
          {([['prefillPhone', 'Pre-fill receiver phone (0000000000)'], ['docDefault', 'Document as default'], ['autoRef', 'Auto customer reference']] as const).map(([k, label]) => (
            <label key={k} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 400, padding: '4px 0' }}>
              {label}<input type="checkbox" checked={st[k]} onChange={(e) => setSetting(k, e.target.checked)} style={{ width: 'auto' }} />
            </label>
          ))}
          <div className="muted" style={{ fontSize: 11.5 }}>Content is always remembered for the next booking, as in the app.</div>
        </div>
      )}

      <Section>Customer</Section>
      <input list="qb-customers" value={custText} onChange={(e) => pickCustomer(e.target.value)} placeholder="🏢 Choose customer — code or name" />
      <datalist id="qb-customers">{customers.map((c) => <option key={c.id} value={`${c.accountCode} — ${c.legalName}`} />)}</datalist>
      {cust && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{[cust.city, cust.pincode].filter(Boolean).join(' · ')}</div>}
      {!cust && custText.trim() && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Pick a customer from the list.</div>}

      <div style={{ marginTop: 10 }}>
        <Field label="Product">
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">— select —</option>
            {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
          </select>
        </Field>
        <Field label="Carrier (optional)">
          <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">— Own network / decide later —</option>
            {vendors.map((v) => <option key={v.code} value={v.code}>{v.code}  {v.name}</option>)}
          </select>
        </Field>
        {sugg.length > 0 && (
          <div style={{ margin: '-4px 0 10px' }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Suggested carriers for {con.pincode} — click to pick</div>
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
        {isDly(vendor) && (
          <Field label="Delhivery first mile">
            <select value={fmPickup ? 'pickup' : 'drop'} onChange={(e) => setFmPickup(e.target.value === 'pickup')}>
              <option value="pickup">Delhivery picks up from the pickup address</option>
              <option value="drop">Self-drop at Delhivery hub</option>
            </select>
          </Field>
        )}
      </div>

      <div className="row" style={{ gap: 0, margin: '6px 0 10px' }}>
        {(['NDOX', 'DOX'] as const).map((t) => (
          <button key={t} className={docType === t ? '' : 'secondary'} style={{ flex: 1, borderRadius: t === 'NDOX' ? '10px 0 0 10px' : '0 10px 10px 0' }} onClick={() => setDocType(t)}>{t === 'NDOX' ? '📦 Parcel' : '📄 Document'}</button>
        ))}
      </div>

      <label className="row" style={{ justifyContent: 'space-between', alignItems: 'center', fontWeight: 400, padding: '4px 0' }}>
        <span><span style={{ fontWeight: 600 }}>Pickup from another address</span><br /><span className="muted" style={{ fontSize: 12 }}>Off = the customer's own address{cust && !pickupElsewhere && cust.addressLine ? ` (${[cust.addressLine, cust.city, cust.pincode].filter(Boolean).join(', ')})` : ''}</span></span>
        <input type="checkbox" checked={pickupElsewhere} onChange={(e) => setPickupElsewhere(e.target.checked)} style={{ width: 'auto' }} />
      </label>
      {pickupElsewhere && (
        <>
          <Field label="Pickup address"><textarea rows={2} value={pick.address} onChange={(e) => setPick((p) => ({ ...p, address: e.target.value }))} /></Field>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Pickup pincode"><input inputMode="numeric" maxLength={6} value={pick.pincode} onChange={(e) => setPick((p) => ({ ...p, pincode: e.target.value }))} /></Field>
            <Field label="Pickup phone"><input inputMode="tel" value={pick.phone} onChange={(e) => setPick((p) => ({ ...p, phone: e.target.value }))} /></Field>
          </div>
        </>
      )}

      <Section>Consignee</Section>
      <Field label="Name"><input value={con.name} onChange={(e) => setCon((c) => ({ ...c, name: e.target.value }))} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Pincode" hint={destCity || undefined}><input inputMode="numeric" maxLength={6} value={con.pincode} onChange={(e) => lookDest(e.target.value)} /></Field>
        <Field label="Phone"><input inputMode="tel" value={con.phone} onChange={(e) => setCon((c) => ({ ...c, phone: e.target.value }))} /></Field>
      </div>
      <Field label="Address"><textarea rows={2} value={con.address} onChange={(e) => setCon((c) => ({ ...c, address: e.target.value }))} /></Field>
      <Field label="GSTIN (optional)">{scan(con.gst, (v) => setCon((c) => ({ ...c, gst: v.toUpperCase() })), '', 'Scan the GST barcode')}</Field>

      <Section>Boxes ({boxes}) — sizes optional</Section>
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ gap: 6, alignItems: 'flex-end', marginBottom: 6 }}>
          <div style={{ width: 70 }}><label style={{ fontSize: 12 }}>Boxes</label><input type="number" inputMode="numeric" value={l.nos} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, nos: e.target.value } : x)))} /></div>
          {(['l', 'w', 'h'] as const).map((k) => (
            <div key={k} style={{ flex: 1 }}><label style={{ fontSize: 12 }}>{k.toUpperCase()} cm</label><input type="number" inputMode="decimal" value={l[k]} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></div>
          ))}
          {lines.length > 1 ? <button className="secondary" style={{ padding: '6px 8px' }} title="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button> : <span style={{ width: 30 }} />}
        </div>
      ))}
      <button className="secondary" style={{ padding: '3px 10px', fontSize: 12, marginBottom: 10 }} onClick={() => setLines((ls) => [...ls, blankLine()])}>＋ Another box size</button>
      <Field label="Total weight (kg)"><input type="number" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} /></Field>
      <Field label="Content / description"><input value={content} onChange={(e) => setContent(e.target.value)} /></Field>

      <Section>Numbers (scan or type)</Section>
      <Field label="AWB no.">{scan(awb, setAwb, 'Blank = auto-generate', 'Scan the AWB barcode')}</Field>
      <Field label="Forwarding / carrier AWB (optional)">{scan(fwd, setFwd, '', 'Scan the carrier barcode')}</Field>
      <Field label="Reference no. (optional)">{scan(ref, setRef, '', 'Scan the reference')}</Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Invoice no.">{scan(invNo, setInvNo, '', 'Scan the invoice barcode')}</Field>
        <Field label="Invoice ₹"><input type="number" inputMode="decimal" value={invAmt} onChange={(e) => setInvAmt(e.target.value)} /></Field>
      </div>
      <Field label={needEway ? 'E-way bill no. (needed: ₹50,000+)' : 'E-way bill no. (optional)'}>{scan(ewb, setEwb, '', 'Scan the e-way bill barcode')}</Field>

      <Section>Photos (optional)</Section>
      <div className="row" style={{ gap: 10 }}>
        {docButton('Invoice', invDoc, setInvDoc)}
        {docButton('E-way bill', ewbDoc, setEwbDoc)}
      </div>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      <div style={{ position: 'sticky', bottom: 0, padding: '14px 0 10px', background: 'var(--bg, #f6f8fa)' }}>
        <button style={{ width: '100%', padding: 14, fontSize: 15 }} disabled={busy} onClick={book}>{busy ? 'Booking…' : '✓ Book shipment'}</button>
        {missing.length > 0 && <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 4 }}>Needed: {missing.join(', ')}</div>}
      </div>
    </>
  );
}

/** Today's (or a picked day's) bookings by me — open one, or tick several of a carrier and print the handover manifest. */
function MyBookings({ onOpen }: { onOpen: (awb: string) => void }) {
  const [day, setDay] = useState(todayIst());
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [vendor, setVendor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = () => {
    setLoading(true); setError('');
    api.myBookings(day).then((r) => { setRows(r.rows); setSel((s) => new Set([...s].filter((a) => r.rows.some((x: any) => x.awb === a)))); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [day]);
  const v = (r: any) => (String(r.vendor || '') ? String(r.vendor).toUpperCase() : 'SELF');
  const vendors = [...new Set(rows.map(v))].sort();
  const shown = rows.filter((r) => vendor == null || v(r) === vendor);
  const printManifest = () => {
    const picked = rows.filter((r) => sel.has(r.awb));
    const vs = [...new Set(picked.map(v))];
    if (vs.length > 1) { alert(`Pick shipments of ONE carrier — a manifest is per carrier (${vs.join(', ')}).`); return; }
    window.open(`/handover/print?date=${day}&vendor=${encodeURIComponent(vs[0])}&awbs=${encodeURIComponent(picked.map((r) => r.awb).join(','))}`, '_blank');
  };
  return (
    <div>
      <div className="row" style={{ gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <input type="date" value={day} max={todayIst()} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: 170 }} />
        <span style={{ flex: 1 }} />
        <button className="secondary" onClick={reload} title="Refresh">⟳</button>
      </div>
      {vendors.length > 1 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {[null, ...vendors].map((x) => <button key={x ?? 'all'} className={vendor === x ? '' : 'secondary'} style={{ padding: '3px 12px', fontSize: 12 }} onClick={() => setVendor(x)}>{x ?? 'All'}</button>)}
        </div>
      )}
      {loading ? <p className="muted">Loading…</p> : error ? <div className="error">{error}</div> : shown.length === 0 ? <p className="muted">No bookings by you on this day.</p> : (
        <div className="card" style={{ padding: 0 }}>
          {shown.map((r) => {
            const carrierAwb = r.bdWaybill ?? r.forwardingAwb;
            return (
              <div key={r.awb} className="row" style={{ gap: 10, alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border, #eceef1)' }}>
                <input type="checkbox" checked={sel.has(r.awb)} style={{ width: 'auto' }} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(r.awb) : n.delete(r.awb); return n; })} />
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(r.awb)}>
                  <div style={{ fontWeight: 700 }}>{r.awb} · {v(r)} <StatusBadge code={r.statusCode || 'MAN'} /></div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{r.customerCode} → {r.consigneeName || ''}, {r.consigneeCity || r.destPincode || ''}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{r.pieceCount} box(es){carrierAwb ? ` · carrier AWB ${carrierAwb}` : ' · not handed to carrier'}</div>
                </div>
                <button className="secondary" style={{ padding: '4px 10px' }} onClick={() => onOpen(r.awb)}>›</button>
              </div>
            );
          })}
        </div>
      )}
      {sel.size > 0 && (
        <div style={{ position: 'sticky', bottom: 0, padding: '10px 0', background: 'var(--bg, #f6f8fa)' }}>
          <button style={{ width: '100%', padding: 12 }} onClick={printManifest}>🖨 Print manifest ({sel.size})</button>
        </div>
      )}
    </div>
  );
}

/** What was booked — edit / cancel / hand to carrier / attach invoice / print (the app's booking summary). */
function BookingSummary({ awb, justBooked, onClose }: { awb: string; justBooked: boolean; onClose: () => void }) {
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [bdCodes, setBdCodes] = useState<string[]>([]);
  const reload = () => api.getShipment(awb).then(setS).catch((e) => setError(e.message));
  useEffect(() => {
    reload();
    api.bdAccountOptions().then((r) => setBdCodes(r.flatMap((a) => [a.customerCode, a.accountCode]).filter(Boolean).map((x) => String(x).toUpperCase()))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awb]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setMsg(''); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  if (!s) return <div style={{ maxWidth: 560, margin: '0 auto' }}>{error ? <div className="error">{error}</div> : <p className="muted">Loading {awb}…</p>}</div>;

  const vend = String(s.vendor || '').toUpperCase();
  const carrier = s.bdWaybill || /^(BLUE|BDR)/.test(vend) || bdCodes.includes(vend) ? 'BD'
    : /DELHIVERY|^DLY/.test(vend) ? 'DLY' : /^XPB$|XPRESS\s*BEES|^XB$/.test(vend) ? 'XB' : /^GATI$|ALLCARGO/.test(vend) ? 'GATI'
    : /^VXP$|^VX$|V\s*EXPRESS/.test(vend) ? 'VXP' : /^ARL$|AR\s*LOG/.test(vend) ? 'ARL' : !vend || vend === 'SELF' ? 'SELF' : 'OTHER';
  const carrierName = ({ BD: 'BlueDart', DLY: 'Delhivery', XB: 'XpressBees', GATI: 'Gati', VXP: 'V Express', ARL: 'AR Logistics', SELF: 'own network' } as Record<string, string>)[carrier] ?? vend;
  const carrierAwb: string | null = s.bdWaybill ?? s.forwardingAwb ?? null;
  const manualCarrierAwb = !s.bdWaybill && (carrier === 'OTHER' || carrier === 'SELF');
  const editable = String(s.statusCode || 'MAN') === 'MAN' && (!carrierAwb || manualCarrierAwb);
  const pieces = s.rollup?.pieceCount ?? s.pieceCount;

  const handoff = () => run(async () => {
    if (carrier === 'OTHER') {
      const f = window.prompt(`${vend} AWB:`); if (!f?.trim()) return;
      await api.setForwarding(awb, { vendor: vend, forwardingAwb: f.trim().toUpperCase() });
      await reload(); setMsg(`Carrier AWB ${f.trim().toUpperCase()} saved.`); return;
    }
    const r = await api.carrierHandoff(awb);
    await reload(); setMsg(r.message || (r.carrierAwb ? `Carrier AWB ${r.carrierAwb} generated.` : 'Sent to the carrier.'));
  });
  const attachInvoice = (f?: File) => f && run(async () => {
    await api.attachShipmentDoc(awb, await fileToDataUrl(f), 'invoice', 'Invoice copy');
    if (carrier !== 'SELF' && carrier !== 'OTHER' && !carrierAwb) {
      const r = await api.carrierHandoff(awb); await reload();
      setMsg(`Invoice attached. ${r.message || 'Sent to the carrier.'}`);
    } else setMsg('Invoice copy attached.');
  });
  const cancel = () => {
    const reason = window.prompt(`Cancel ${awb}? The booking is cancelled and drops off your list. This cannot be undone.\n\nReason:`, 'Booked by mistake');
    if (reason == null) return;
    run(async () => { await api.cancelShipment(awb, reason.trim() || 'Cancelled at booking desk'); onClose(); });
  };
  const row = (k: string, v: any) => (v == null || String(v) === '' ? null : <div className="row" style={{ gap: 8, padding: '3px 0' }}><span className="muted" style={{ width: 120, flexShrink: 0 }}>{k}</span><strong style={{ fontWeight: 600 }}>{String(v)}</strong></div>);
  const btn: React.CSSProperties = { width: '100%', padding: 12, marginTop: 10 };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 40 }}>
      <button className="secondary" style={{ padding: '3px 10px', marginBottom: 10 }} onClick={onClose}>← {justBooked ? 'Book next' : 'Back'}</button>
      {justBooked && (
        <div className="card" style={{ background: '#dcfce7', borderColor: '#86efac', color: '#14532d' }}>
          <strong style={{ fontSize: 16 }}>✅ Booked — {awb}</strong>
          <div style={{ fontSize: 13, color: '#166534' }}>Check the details. Use Edit if anything is wrong.</div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{s.client?.accountCode} — {s.client?.legalName}</strong><StatusBadge code={s.statusCode || 'MAN'} />
        </div>
        <Section>Shipment</Section>
        {row('Product', s.product)}
        {row('Carrier', vend || 'Own network')}
        {row('Carrier AWB', carrierAwb)}
        {row('Boxes', pieces)}
        {row('Weight (kg)', s.chargeWeight ?? s.rollup?.totalDeadKg)}
        {row('Content', s.goodsDesc)}
        {row('Reference', s.referenceNo)}
        {row('Invoice', [s.custInvoiceNo ?? s.invoiceNo, s.declaredValue != null ? `₹${s.declaredValue}` : null].filter(Boolean).join(' · '))}
        {row('E-way bill', s.ewbNo)}
        <Section>Consignee</Section>
        {row('Name', s.consigneeName)}
        {row('Phone', s.consigneePhone)}
        {row('Address', [s.consigneeAddress, s.consigneeCity, s.destPincode].filter(Boolean).join(', '))}
      </div>

      {editable && <Link to={`/shipments/${awb}`}><button className="secondary" style={btn}>✎ Edit booking</button></Link>}
      {editable && <button className="secondary" style={{ ...btn, color: 'var(--bad, #c0392b)', borderColor: 'var(--bad, #c0392b)' }} disabled={busy} onClick={cancel}>🗑 Cancel booking</button>}
      {carrier !== 'SELF' && !carrierAwb && <button style={btn} disabled={busy} onClick={handoff}>{busy ? 'Working…' : carrier === 'OTHER' ? `Enter ${vend} AWB` : `➤ Hand to ${carrierName} — generate AWB`}</button>}
      <label className="button secondary" style={{ ...btn, display: 'block', textAlign: 'center', cursor: 'pointer', border: '1px solid var(--border, #d0d5dd)', borderRadius: 8, fontWeight: 600 }}>
        📎 Attach invoice copy
        <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; attachInvoice(f); }} />
      </label>

      <Section>Print</Section>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <a href={`/shipments/${awb}/awb-print`} target="_blank" rel="noreferrer"><button className="secondary">📄 AWB copy</button></a>
        <a href={`/shipments/${awb}/bd-label`} target="_blank" rel="noreferrer"><button className="secondary">🏷 Courier label</button></a>
        {s.bdWaybill && <a href={`/shipments/${awb}/bd-awb`} target="_blank" rel="noreferrer"><button className="secondary">🚚 BlueDart AWB</button></a>}
      </div>
    </div>
  );
}
