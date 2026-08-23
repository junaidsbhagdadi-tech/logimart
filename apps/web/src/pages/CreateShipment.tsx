import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Client } from '../api';
import { useAuth } from '../auth';
import { mapMode, modeLabel } from '../productMode';
import { expandCity } from '../lib/cityCodes';

interface PieceForm { deadKg: string; lengthCm: string; widthCm: string; heightCm: string; }
const blank: PieceForm = { deadKg: '', lengthCm: '', widthCm: '', heightCm: '' };

const VOL_DIVISOR = 5000;
const volOf = (p: PieceForm) => {
  const l = +p.lengthCm, w = +p.widthCm, h = +p.heightCm;
  return l && w && h ? +(l * w * h / VOL_DIVISOR).toFixed(3) : 0;
};

type PinInfo = Awaited<ReturnType<typeof api.lookupPincode>>;

export function CreateShipment() {
  const nav = useNavigate();
  const { user } = useAuth();
  const ownClientId = user?.clientId ? Number(user.clientId) : null;
  const isClient = user?.role === 'CLIENT_ADMIN'; // customers get a simplified form: no pricing/ops/carrier fields

  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | ''>(ownClientId ?? '');
  const [custText, setCustText] = useState('');
  const [prodText, setProdText] = useState('');
  const [ftl, setFtl] = useState({ vehicleNo: '', ftlVehicleType: '32FT SXL', departureAt: '', arrivalAt: '' });

  const [originPin, setOriginPin] = useState('');
  const [destPin, setDestPin] = useState('');
  const [originInfo, setOriginInfo] = useState<PinInfo | null>(null);
  const [destInfo, setDestInfo] = useState<PinInfo | null>(null);

  const [c, setC] = useState({
    consigneeName: '', consigneePhone: '', consigneeAddress: '', consigneeCity: '',
    consigneeGstin: '', declaredValue: '', goodsDesc: '', hsnCode: '',
    consigneeContact: '', consigneeState: '', consigneeCountry: 'India', consigneeIec: '', consigneeDocType: '', consigneeDocNo: '',
  });

  // shipper (sender) — a full party, separate from the billing customer
  const [shp, setShp] = useState({
    shipperName: '', shipperContact: '', shipperAddress1: '', shipperAddress2: '',
    shipperPincode: '', shipperCity: '', shipperState: '', shipperPhone: '', shipperMobile: '',
    shipperEmail: '', shipperCountry: 'India', shipperIec: '', shipperGstin: '', shipperDocType: '', shipperDocNo: '',
    originLocation: '',
  });
  const setS = (k: keyof typeof shp, v: string) => setShp((p) => ({ ...p, [k]: v }));
  // Shipper auto-fills from the selected customer's registered details; tick "pickup out of
  // home location" to enter a different pickup address manually.
  const [pickupElsewhere, setPickupElsewhere] = useState(false);
  // services extras
  const [svc, setSvc] = useState({ vendor: '', service: '', shipmentValue: '', referenceNo: '', isCommercial: false, isMedical: false });
  const [flags, setFlags] = useState({ oda: false, appt: false });
  const [svcOptions, setSvcOptions] = useState<{ network: string; mode: string | null; tatDays: number | null; isOda: boolean }[]>([]);

  const [hubs, setHubs] = useState<{ id: string; code: string; name: string }[]>([]);
  const [originHubId, setOriginHubId] = useState<number | ''>('');
  const [destHubId, setDestHubId] = useState<number | ''>('');
  const [ewbNo, setEwbNo] = useState('');

  // services + charges (from the Product / Charges masters)
  const [products, setProducts] = useState<{ code: string; name: string; type?: string; mode?: string }[]>([]);
  const [chargeMasters, setChargeMasters] = useState<{ code: string; name: string }[]>([]);
  const [product, setProduct] = useState('');
  const [docType, setDocType] = useState<'DOX' | 'NDOX'>('NDOX');
  const [chargeWeight, setChargeWeight] = useState('');
  const [charges, setCharges] = useState<{ code: string; name: string; amount: number }[]>([]);
  const [chargeCode, setChargeCode] = useState('');
  const [chargeAmt, setChargeAmt] = useState('');

  // Product is the single service selector (Xpresion-style); transport mode is derived from it.
  const selProduct = products.find((p) => p.code === product);
  const serviceMode = selProduct?.mode || 'ROAD_PTL';
  const isFtl = serviceMode === 'ROAD_FTL';

  const [pieces, setPieces] = useState<PieceForm[]>([{ ...blank }]);
  const [manualFreight, setManualFreight] = useState('');
  const [manualAwb, setManualAwb] = useState('');
  const [paymentTerm, setPaymentTerm] = useState<'PREPAID' | 'TO_PAY'>('PREPAID');
  const [freightToCollect, setFreightToCollect] = useState('');
  const [isDod, setIsDod] = useState(false);
  const [dodInstrument, setDodInstrument] = useState<'CHEQUE' | 'DD'>('CHEQUE');
  const [dodAmount, setDodAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);
  const [cwTouched, setCwTouched] = useState(false);
  const [autoCarrier, setAutoCarrier] = useState<{ vendor: string; minWeight?: number; maxWeight?: number } | null>(null);
  const [vendorTouched, setVendorTouched] = useState(false);

  // ---- Draft autosave: keep the whole form in localStorage so navigating away
  // (e.g. to add a vendor / fix a pincode) and coming back never wipes the data. ----
  const DRAFT_KEY = 'lm_create_draft_v1';
  const [ready, setReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftSnapshot = () => ({
    clientId, custText, prodText, ftl, originPin, destPin, c, shp, svc, flags,
    originHubId, destHubId, ewbNo, product, docType, chargeWeight, charges, chargeCode, chargeAmt,
    paymentTerm, freightToCollect, isDod, dodInstrument, dodAmount, manualFreight, manualAwb, pieces, pickupElsewhere,
  });
  // restore once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.clientId !== undefined) setClientId(d.clientId);
        if (d.custText != null) setCustText(d.custText);
        if (d.prodText != null) setProdText(d.prodText);
        if (d.ftl) setFtl(d.ftl); if (d.originPin != null) setOriginPin(d.originPin); if (d.destPin != null) setDestPin(d.destPin);
        if (d.c) setC(d.c); if (d.shp) setShp(d.shp); if (d.svc) setSvc(d.svc); if (d.flags) setFlags(d.flags);
        if (d.originHubId !== undefined) setOriginHubId(d.originHubId); if (d.destHubId !== undefined) setDestHubId(d.destHubId);
        if (d.ewbNo != null) setEwbNo(d.ewbNo); if (d.product != null) setProduct(d.product); if (d.docType) setDocType(d.docType);
        if (d.chargeWeight != null) setChargeWeight(d.chargeWeight); if (Array.isArray(d.charges)) setCharges(d.charges);
        if (d.chargeCode != null) setChargeCode(d.chargeCode); if (d.chargeAmt != null) setChargeAmt(d.chargeAmt);
        if (d.paymentTerm) setPaymentTerm(d.paymentTerm); if (d.freightToCollect != null) setFreightToCollect(d.freightToCollect);
        if (d.isDod != null) setIsDod(d.isDod); if (d.dodInstrument) setDodInstrument(d.dodInstrument); if (d.dodAmount != null) setDodAmount(d.dodAmount);
        if (d.manualFreight != null) setManualFreight(d.manualFreight); if (d.manualAwb != null) setManualAwb(d.manualAwb);
        if (Array.isArray(d.pieces) && d.pieces.length) setPieces(d.pieces);
        if (d.pickupElsewhere != null) setPickupElsewhere(d.pickupElsewhere);
        setDraftRestored(true);
      }
    } catch { /* ignore */ }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // save on every change (after the initial restore)
  const snapJson = JSON.stringify(draftSnapshot());
  useEffect(() => { if (ready) { try { localStorage.setItem(DRAFT_KEY, snapJson); } catch { /* quota */ } } }, [ready, snapJson]);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ } };
  const startFresh = () => { clearDraft(); window.location.reload(); };

  useEffect(() => { if (!ownClientId) api.listClients().then(setClients).catch(() => {}); }, [ownClientId]);

  // Auto-fill shipper from the selected customer's registered address (unless picking up elsewhere).
  useEffect(() => {
    if (pickupElsewhere || clientId === '') return;
    const cl = clients.find((c) => String(c.id) === String(clientId));
    if (!cl) return;
    setShp((prev) => ({
      ...prev,
      shipperName: cl.legalName ?? '',
      shipperContact: cl.contactPerson ?? '',
      shipperGstin: cl.gstin ?? '',
      shipperAddress1: (cl as any).addressLine ?? '',
      shipperPincode: (cl as any).pincode ?? '',
      shipperCity: cl.city ?? '',
      shipperState: cl.state ?? cl.billingState ?? '',
      shipperPhone: cl.contactPhone ?? '',
      shipperEmail: cl.contactEmail ?? '',
      originLocation: cl.city ?? prev.originLocation,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, pickupElsewhere, clients]);
  useEffect(() => { api.listVendors().then((v) => setVendors(v.filter((x: any) => x.isActive !== false))).catch(() => {}); }, []);
  useEffect(() => {
    api.listHubs().then((hs) => {
      setHubs(hs);
      if (hs[0]) setOriginHubId(Number(hs[0].id));
      setDestHubId(Number((hs[1] ?? hs[0])?.id));
    }).catch(() => {});
    api.listMaster('PRODUCT').then((r) => setProducts(r.map((x) => ({ code: x.code, name: x.name, type: (x.attrs as any)?.productType || (x.attrs as any)?.groupType, mode: mapMode((x.attrs as any)?.service || (x.attrs as any)?.mode || (x.attrs as any)?.serviceMode || (x.attrs as any)?.groupType) })))).catch(() => {});
    api.listMaster('CHARGE').then((r) => setChargeMasters(r.map((x) => ({ code: x.code, name: x.name })))).catch(() => {});
  }, []);

  const addCharge = () => {
    const cm = chargeMasters.find((c) => c.code === chargeCode);
    if (!cm || !(Number(chargeAmt) > 0)) return;
    setCharges((cs) => [...cs.filter((c) => c.code !== cm.code), { code: cm.code, name: cm.name, amount: Number(chargeAmt) }]);
    setChargeCode(''); setChargeAmt('');
  };
  const chargesTotal = charges.reduce((s, c) => s + c.amount, 0);

  const lookOrigin = async (p: string) => {
    setOriginPin(p);
    if (/^\d{6}$/.test(p)) setOriginInfo(await api.lookupPincode(p).catch(() => null));
    else setOriginInfo(null);
  };
  const lookDest = async (p: string) => {
    setDestPin(p);
    if (/^\d{6}$/.test(p)) {
      const info = await api.lookupPincode(p).catch(() => null);
      setDestInfo(info);
      // auto-fetch city + state from the pincode master (expand city code → full name)
      if (info) setC((prev) => ({ ...prev, consigneeCity: info.city ? expandCity(info.city) : prev.consigneeCity, consigneeState: info.state ?? prev.consigneeState }));
      // which carrier products serve this pincode? auto-pick the fastest BlueDart product.
      const opts = await api.serviceOptions(p).catch(() => []);
      setSvcOptions(opts);
      const best = opts.find((o) => /^BLUEDART-/.test(o.network)) || opts.find((o) => o.network.startsWith('BLUEDART')) || opts[0];
      if (best) setSvc((s) => ({ ...s, vendor: best.network, service: best.mode || s.service }));
      if (best?.isOda) setFlags((f) => ({ ...f, oda: true }));
    } else { setDestInfo(null); setSvcOptions([]); }
  };

  const lookShipper = async (p: string) => {
    setS('shipperPincode', p);
    if (/^\d{6}$/.test(p)) {
      const info = await api.lookupPincode(p).catch(() => null);
      if (info) setShp((prev) => ({ ...prev, shipperCity: info.city ? expandCity(info.city) : prev.shipperCity, shipperState: info.state ?? prev.shipperState }));
    }
  };
  const setCf = (k: keyof typeof c, v: string) => setC((p) => ({ ...p, [k]: v }));
  const update = (i: number, k: keyof PieceForm, v: string) =>
    setPieces((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const addPiece = () => setPieces((ps) => [...ps, { ...blank }]);
  const removePiece = (i: number) => setPieces((ps) => ps.filter((_, idx) => idx !== i));

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await api.createShipment({
        clientId: Number(clientId),
        serviceMode,
        originHubId: originHubId ? Number(originHubId) : undefined,
        destHubId: destHubId ? Number(destHubId) : undefined,
        originZone: originInfo?.region ?? 'SOUTH',
        destZone: destInfo?.region ?? 'SOUTH',
        originPincode: originPin || undefined,
        destPincode: destPin || undefined,
        isOda: flags.oda || (destInfo?.isOda ?? false),
        apptDelivery: flags.appt,
        consigneeName: c.consigneeName || undefined,
        consigneePhone: c.consigneePhone || undefined,
        consigneeAddress: c.consigneeAddress || undefined,
        consigneeCity: c.consigneeCity || destInfo?.city || undefined,
        consigneeGstin: c.consigneeGstin || undefined,
        declaredValue: c.declaredValue ? +c.declaredValue : undefined,
        goodsDesc: c.goodsDesc || undefined,
        // shipper (sender)
        ...Object.fromEntries(Object.entries(shp).map(([k, v]) => [k, v || undefined])),
        // consignee extras
        consigneeContact: c.consigneeContact || undefined,
        consigneeState: c.consigneeState || undefined,
        consigneeCountry: c.consigneeCountry || undefined,
        consigneeIec: c.consigneeIec || undefined,
        consigneeDocType: c.consigneeDocType || undefined,
        consigneeDocNo: c.consigneeDocNo || undefined,
        // services extras
        vendor: svc.vendor || undefined,
        service: svc.service || undefined,
        shipmentValue: svc.shipmentValue ? +svc.shipmentValue : undefined,
        referenceNo: svc.referenceNo || undefined,
        isCommercial: svc.isCommercial,
        isMedical: svc.isMedical,
        hsnCode: c.hsnCode || undefined,
        vehicleNo: ftl.vehicleNo || undefined,
        ftlVehicleType: isFtl ? ftl.ftlVehicleType : undefined,
        departureAt: ftl.departureAt ? new Date(ftl.departureAt).toISOString() : undefined,
        arrivalAt: ftl.arrivalAt ? new Date(ftl.arrivalAt).toISOString() : undefined,
        manualFreight: manualFreight ? +manualFreight : undefined,
        manualAwb: manualAwb.trim() || undefined,
        ewbNo: needEway && ewbNo ? ewbNo : undefined,
        product: product || undefined,
        docType,
        chargeWeight: chargeWeight ? +chargeWeight : undefined,
        charges: charges.length ? charges : undefined,
        paymentTerm,
        freightToCollect: paymentTerm === 'TO_PAY' && freightToCollect ? +freightToCollect : undefined,
        isDod,
        dodInstrument: isDod ? dodInstrument : undefined,
        dodAmount: isDod && dodAmount ? +dodAmount : undefined,
        pieces: pieces.map((p) => ({
          deadKg: +p.deadKg,
          lengthCm: p.lengthCm ? +p.lengthCm : undefined,
          widthCm: p.widthCm ? +p.widthCm : undefined,
          heightCm: p.heightCm ? +p.heightCm : undefined,
        })),
      });
      clearDraft(); // booked successfully — drop the saved draft
      nav(`/shipments/${res.awb}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pinHint = (info: PinInfo | null) =>
    info?.region ? (
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {info.city ? `${info.city}, ${info.state} · ` : ''}<strong>{info.region}</strong>
        {info.tier ? ` · Tier ${info.tier}` : ''}{info.isOda ? ' · ODA' : ''}
      </div>
    ) : null;

  const totalDead = pieces.reduce((s, p) => s + (+p.deadKg || 0), 0);
  const totalVol = pieces.reduce((s, p) => s + volOf(p), 0);
  // Charge weight auto-calculates from the boxes (max of actual dead vs volumetric); editable to override.
  useEffect(() => {
    if (cwTouched) return;
    const m = Math.max(totalDead, totalVol);
    setChargeWeight(m > 0 ? String(+m.toFixed(3)) : '');
  }, [totalDead, totalVol, cwTouched]);
  // Auto-pick the carrier from Service Mapping by chargeable weight (+ single-piece), unless the
  // operator has manually chosen a vendor.
  const chargeableKg = chargeWeight ? +chargeWeight : Math.max(totalDead, totalVol);
  useEffect(() => {
    if (!chargeableKg || chargeableKg <= 0) { setAutoCarrier(null); return; }
    let cancelled = false;
    api.resolveCarrier(chargeableKg, undefined, pieces.length === 1)
      .then((m) => { if (cancelled) return; setAutoCarrier(m); if (m && !vendorTouched) setSvc((s) => ({ ...s, vendor: m.vendor })); })
      .catch(() => { if (!cancelled) setAutoCarrier(null); });
    return () => { cancelled = true; };
  }, [chargeableKg, pieces.length, vendorTouched]);
  const EWB_THRESHOLD = 50000;
  const needEway = Number(c.declaredValue) >= EWB_THRESHOLD;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>New MPS Shipment</h1>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="secondary" onClick={startFresh} title="Discard everything on this form and start a blank shipment">🧹 Clear form</button>
          <button type="button" className="secondary" onClick={() => nav('/bulk')} title="Bulk import shipments (incl. manually-booked AWBs)">📥 Bulk import</button>
        </div>
      </div>
      {draftRestored && (
        <div className="card" style={{ borderLeft: '4px solid var(--brand)', marginTop: 10, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>↩ <strong>Draft restored.</strong> Your last unsaved entries are back — edit anything and continue. Nothing is lost if you navigate away.</span>
          <button type="button" className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setDraftRestored(false)}>Dismiss</button>
        </div>
      )}
      {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}

      <div className="card">
        <h2>Booking</h2>
        <div className="grid cols-3">
          {!ownClientId && (
            <div>
              <label>Customer *</label>
              <input
                list="lm-customers"
                value={custText}
                placeholder="search by name or code…"
                onChange={(e) => {
                  const v = e.target.value; setCustText(v);
                  const m = clients.find((c) => `${c.accountCode} — ${c.legalName}` === v || c.accountCode.toLowerCase() === v.toLowerCase() || c.legalName.toLowerCase() === v.toLowerCase());
                  setClientId(m ? Number(m.id) : '');
                }}
              />
              <datalist id="lm-customers">{clients.map((cl) => <option key={cl.id} value={`${cl.accountCode} — ${cl.legalName}`} />)}</datalist>
            </div>
          )}
          <div>
            <label>Product * <span className="muted">({products.length})</span></label>
            <select
              value={product}
              onChange={(e) => { const code = e.target.value; setProduct(code); const m = products.find((p) => p.code === code); setProdText(m ? `${m.code} — ${m.name}` : ''); }}
            >
              <option value="">Select product</option>
              {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}{p.type ? ` (${p.type})` : ''}</option>)}
            </select>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Mode: <strong>{modeLabel(serviceMode)}</strong>{product && !selProduct?.mode ? ' (default — set this product’s mode in Masters)' : ''}
            </div>
          </div>
          {hubs.length > 0 && (
            <>
              <div>
                <label>Origin hub <span className="muted">(optional — blank = direct)</span></label>
                <select value={originHubId} onChange={(e) => setOriginHubId(e.target.value ? +e.target.value : '')}>
                  <option value="">— Direct (no hub) —</option>
                  {hubs.map((hb) => <option key={hb.id} value={hb.id}>{hb.code} — {hb.name}</option>)}
                </select>
              </div>
              <div>
                <label>Destination hub <span className="muted">(optional — blank = direct)</span></label>
                <select value={destHubId} onChange={(e) => setDestHubId(e.target.value ? +e.target.value : '')}>
                  <option value="">— Direct (no hub) —</option>
                  {hubs.map((hb) => <option key={hb.id} value={hb.id}>{hb.code} — {hb.name}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <label>Origin pincode</label>
            <input value={originPin} onChange={(e) => lookOrigin(e.target.value)} maxLength={6} placeholder="e.g. 560001" />
            {pinHint(originInfo)}
          </div>
          <div>
            <label>Destination pincode</label>
            <input value={destPin} onChange={(e) => lookDest(e.target.value)} maxLength={6} placeholder="e.g. 781001" />
            {pinHint(destInfo)}
          </div>
        </div>
        {svcOptions.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: '#f6f9f4' }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Carrier products serving {destPin} — fastest auto-picked</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {svcOptions.map((o) => {
                const picked = o.network === svc.vendor;
                return (
                  <button key={o.network} type="button"
                    className={picked ? '' : 'secondary'}
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => setSvc((s) => ({ ...s, vendor: o.network, service: o.mode || s.service }))}>
                    {o.network} · {o.mode ?? '—'} · {o.tatDays != null ? `${o.tatDays}d` : 'TAT ?'}{o.isOda ? ' · ODA' : ''}{picked ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isFtl && (
        <div className="card">
          <h2>🚛 FTL trip details</h2>
          <div className="grid cols-3">
            <div>
              <label>Vehicle type</label>
              <select value={ftl.ftlVehicleType} onChange={(e) => setFtl({ ...ftl, ftlVehicleType: e.target.value })}>
                {['8ft', '10ft', '14ft', '17ft', '20ft', '32FT SXL', '32ft MXL'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div><label>Vehicle number</label><input value={ftl.vehicleNo} onChange={(e) => setFtl({ ...ftl, vehicleNo: e.target.value })} placeholder="KA01AB1234" /></div>
            <div><label>&nbsp;</label><span className="muted" style={{ fontSize: 12 }}>Full-truck-load consignment</span></div>
            <div><label>Departure date &amp; time</label><input type="datetime-local" value={ftl.departureAt} onChange={(e) => setFtl({ ...ftl, departureAt: e.target.value })} /></div>
            <div><label>Arrival date &amp; time</label><input type="datetime-local" value={ftl.arrivalAt} onChange={(e) => setFtl({ ...ftl, arrivalAt: e.target.value })} /></div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>📤 Shipper details <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>— {pickupElsewhere ? 'enter the pickup address' : 'auto-filled from the customer'}</span></h2>
          <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={pickupElsewhere}
              onChange={(e) => { const v = e.target.checked; setPickupElsewhere(v); if (v) setShp((p) => ({ ...p, shipperName: '', shipperContact: '', shipperGstin: '', shipperAddress1: '', shipperAddress2: '', shipperPincode: '', shipperCity: '', shipperState: '', shipperPhone: '', shipperMobile: '', shipperEmail: '', originLocation: '' })); }} />
            🚚 Pickup out of home location
          </label>
        </div>
        <fieldset disabled={!pickupElsewhere && clientId !== ''} style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 'auto' }}>
        <div className="grid cols-4" style={{ marginTop: 10 }}>
          <div><label>Origin</label><input value={shp.originLocation} onChange={(e) => setS('originLocation', e.target.value)} placeholder="e.g. DELHI" /></div>
          <div><label>Company name</label><input value={shp.shipperName} onChange={(e) => setS('shipperName', e.target.value)} /></div>
          <div><label>Contact name</label><input value={shp.shipperContact} onChange={(e) => setS('shipperContact', e.target.value)} /></div>
          <div><label>Mobile</label><input value={shp.shipperMobile} onChange={(e) => setS('shipperMobile', e.target.value)} /></div>

          <div><label>Address 1</label><input value={shp.shipperAddress1} onChange={(e) => setS('shipperAddress1', e.target.value)} /></div>
          <div><label>Address 2</label><input value={shp.shipperAddress2} onChange={(e) => setS('shipperAddress2', e.target.value)} /></div>
          <div><label>Pincode <span className="muted">(auto city/state)</span></label><input value={shp.shipperPincode} maxLength={6} onChange={(e) => lookShipper(e.target.value)} /></div>
          <div><label>City</label><input value={shp.shipperCity} onChange={(e) => setS('shipperCity', e.target.value)} /></div>

          <div><label>State</label><input value={shp.shipperState} onChange={(e) => setS('shipperState', e.target.value)} /></div>
          <div><label>Telephone</label><input value={shp.shipperPhone} onChange={(e) => setS('shipperPhone', e.target.value)} /></div>
          <div><label>E-mail</label><input value={shp.shipperEmail} onChange={(e) => setS('shipperEmail', e.target.value)} /></div>
          <div><label>Country</label><input value={shp.shipperCountry} onChange={(e) => setS('shipperCountry', e.target.value)} /></div>

          <div><label>GSTIN</label><input value={shp.shipperGstin} onChange={(e) => setS('shipperGstin', e.target.value.toUpperCase())} /></div>
          <div><label>IEC No.</label><input value={shp.shipperIec} onChange={(e) => setS('shipperIec', e.target.value)} /></div>
          <div>
            <label>Document Type</label>
            <select value={shp.shipperDocType} onChange={(e) => setS('shipperDocType', e.target.value)}>
              <option value="">Select</option><option>PAN</option><option>Aadhaar</option><option>Passport</option><option>GSTIN</option><option>Other</option>
            </select>
          </div>
          <div><label>Document No.</label><input value={shp.shipperDocNo} onChange={(e) => setS('shipperDocNo', e.target.value)} /></div>
        </div>
        </fieldset>
      </div>

      <div className="card">
        <h2>Consignee &amp; consignment</h2>
        <div className="grid cols-3">
          <div><label>Consignee name</label><input value={c.consigneeName} onChange={(e) => setCf('consigneeName', e.target.value)} /></div>
          <div><label>Phone</label><input value={c.consigneePhone} onChange={(e) => setCf('consigneePhone', e.target.value)} /></div>
          <div><label>GSTIN</label><input value={c.consigneeGstin} onChange={(e) => setCf('consigneeGstin', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Address</label><input value={c.consigneeAddress} onChange={(e) => setCf('consigneeAddress', e.target.value)} /></div>
          <div><label>Pincode <span className="muted">(auto city/state)</span></label><input value={destPin} maxLength={6} onChange={(e) => lookDest(e.target.value)} placeholder="e.g. 110001" /></div>
          <div><label>City</label><input value={c.consigneeCity} onChange={(e) => setCf('consigneeCity', e.target.value)} placeholder={destInfo?.city || ''} /></div>
          <div><label>State</label><input value={c.consigneeState} onChange={(e) => setCf('consigneeState', e.target.value)} placeholder={destInfo?.state || ''} /></div>
          <div><label>Invoice / declared value ₹</label><input type="number" value={c.declaredValue} onChange={(e) => setCf('declaredValue', e.target.value)} /></div>
          {!isClient && <div><label>Agreed freight ₹ (one-time — overrides rate card)</label><input type="number" value={manualFreight} onChange={(e) => setManualFreight(e.target.value)} placeholder="optional" /></div>}
          {!isClient && <div><label>Manual AWB <span className="muted">(pre-printed / hand-written — blank = auto)</span></label><input value={manualAwb} onChange={(e) => setManualAwb(e.target.value)} placeholder="e.g. 2030236" /></div>}
          <div><label>HSN</label><input value={c.hsnCode} onChange={(e) => setCf('hsnCode', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Goods description</label><input value={c.goodsDesc} onChange={(e) => setCf('goodsDesc', e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 20, marginTop: 10 }}>
          {!isClient && <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={flags.oda} onChange={(e) => setFlags({ ...flags, oda: e.target.checked })} /> ODA (out-of-delivery-area)</label>}
          <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={flags.appt} onChange={(e) => setFlags({ ...flags, appt: e.target.checked })} /> Appointment delivery</label>
        </div>
      </div>

      <div className="card">
        <h2>🧾 Services &amp; charges</h2>
        <p className="muted" style={{ marginTop: -8 }}>Product (which sets the service mode) is chosen above under Booking.</p>
        <div className="grid cols-3">
          <div>
            <label>Doc type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value as 'DOX' | 'NDOX')}>
              <option value="NDOX">NDOX (non-document)</option>
              <option value="DOX">DOX (document)</option>
            </select>
          </div>
          <div>
            <label>Chargeable weight (kg) <span className="muted">— max(actual dead, volumetric) from boxes; edit to override</span></label>
            <input type="number" value={chargeWeight} onChange={(e) => { setCwTouched(true); setChargeWeight(e.target.value); }} placeholder={`${Math.max(totalDead, totalVol).toFixed(2)} (dead/vol max)`} />
            {cwTouched && <button className="secondary" style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }} onClick={() => setCwTouched(false)}>↺ auto</button>}
          </div>
          {!isClient && <div>
            <label>Vendor <span className="muted">(type 3-letter code, e.g. BDR)</span></label>
            <input list="lm-vendor-codes" value={svc.vendor} placeholder="SELF or vendor code"
              onChange={(e) => { setVendorTouched(true); setSvc({ ...svc, vendor: e.target.value.toUpperCase() }); }} />
            <datalist id="lm-vendor-codes">
              {vendors.map((v) => <option key={v.id} value={(v.vendorCode || v.name).toUpperCase()}>{v.vendorCode} — {v.name}</option>)}
            </datalist>
            {(() => { const vc = svc.vendor.trim().toUpperCase(); const m = vendors.find((v) => String(v.vendorCode || '').toUpperCase() === vc); return vc && vc !== 'SELF' && m ? <div className="muted" style={{ fontSize: 11, marginTop: 4, color: 'var(--ok, #16a34a)' }}>✓ {m.name}</div> : null; })()}
            {autoCarrier && !vendorTouched && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4, color: 'var(--brand)' }}>
                🔀 Auto-picked from Service Mapping{autoCarrier.maxWeight ? ` (band ${autoCarrier.minWeight}–${autoCarrier.maxWeight}kg)` : ''}
              </div>
            )}
            {vendorTouched && autoCarrier && (
              <button className="secondary" style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }} onClick={() => { setVendorTouched(false); setSvc((s) => ({ ...s, vendor: autoCarrier.vendor })); }}>↺ auto-pick</button>
            )}
          </div>}
          {!isClient && <div><label>Service</label><input value={svc.service} onChange={(e) => setSvc({ ...svc, service: e.target.value })} placeholder="SELF / DHL / …" /></div>}
          <div><label>Shipment value ₹</label><input type="number" value={svc.shipmentValue} onChange={(e) => setSvc({ ...svc, shipmentValue: e.target.value })} /></div>
          <div><label>Reference No.</label><input value={svc.referenceNo} onChange={(e) => setSvc({ ...svc, referenceNo: e.target.value })} /></div>
        </div>
        <div className="row" style={{ gap: 20, marginTop: 10 }}>
          <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={svc.isCommercial} onChange={(e) => setSvc({ ...svc, isCommercial: e.target.checked })} /> Commercial</label>
          {!isClient && <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={svc.isMedical} onChange={(e) => setSvc({ ...svc, isMedical: e.target.checked })} /> Medical charges</label>}
        </div>

        {!isClient && <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 2 }}>
            <label>Add charge (from Charges master)</label>
            <select value={chargeCode} onChange={(e) => setChargeCode(e.target.value)}>
              <option value="">— select charge —</option>
              {chargeMasters.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Amount ₹</label>
            <input type="number" value={chargeAmt} onChange={(e) => setChargeAmt(e.target.value)} />
          </div>
          <button className="secondary" onClick={addCharge} disabled={!chargeCode || !(Number(chargeAmt) > 0)}>+ Add</button>
        </div>}

        {charges.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Code</th><th>Charge</th><th style={{ textAlign: 'right' }}>Amount ₹</th><th></th></tr></thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.code}>
                  <td><strong>{c.code}</strong></td><td>{c.name}</td>
                  <td style={{ textAlign: 'right' }}>{c.amount.toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}><button className="secondary" style={{ padding: '4px 10px' }} onClick={() => setCharges((cs) => cs.filter((x) => x.code !== c.code))}>✕</button></td>
                </tr>
              ))}
              <tr><td colSpan={2}><strong>Total charges</strong></td><td style={{ textAlign: 'right' }}><strong>₹{chargesTotal.toFixed(2)}</strong></td><td></td></tr>
            </tbody>
          </table>
        )}
        {chargeMasters.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Tip: add charges in 🗃 Masters → Charges to pick them here.</p>}
      </div>

      {needEway && (
        <div className="card" style={{ borderLeft: '4px solid var(--warn)', background: '#fffdf4' }}>
          <h2 style={{ color: 'var(--warn)' }}>🛣 E-way bill required</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
            Invoice value <strong>₹{Number(c.declaredValue).toLocaleString('en-IN')}</strong> is ₹50,000 or more — an e-way bill is mandatory for this consignment.
          </p>
          <div className="grid cols-3">
            <div style={{ gridColumn: 'span 2' }}>
              <label>E-way bill number (if already generated)</label>
              <input value={ewbNo} onChange={(e) => setEwbNo(e.target.value)} placeholder="e.g. 1234 5678 9012" />
            </div>
            <div style={{ alignSelf: 'end' }}>
              <span className="muted" style={{ fontSize: 12 }}>Leave blank to <strong>auto-generate</strong> the e-way bill at booking.</span>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>💳 Payment &amp; collection</h2>
        <div className="grid cols-3">
          <div>
            <label>Freight payment term</label>
            <select value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value as 'PREPAID' | 'TO_PAY')}>
              <option value="PREPAID">Prepaid — bill to account</option>
              <option value="TO_PAY">To-Pay — collect freight from consignee</option>
            </select>
          </div>
          {paymentTerm === 'TO_PAY' && (
            <div>
              <label>Freight to collect ₹</label>
              <input type="number" value={freightToCollect} onChange={(e) => setFreightToCollect(e.target.value)} placeholder="collected at delivery" />
            </div>
          )}
          <div style={{ gridColumn: paymentTerm === 'TO_PAY' ? undefined : 'span 2' }}>
            <label>Draft on Delivery (DOD)</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--text)', marginTop: 4, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={isDod} onChange={(e) => setIsDod(e.target.checked)} />
              Collect a cheque / DD before delivery
            </label>
          </div>
          {isDod && (
            <>
              <div>
                <label>Instrument</label>
                <select value={dodInstrument} onChange={(e) => setDodInstrument(e.target.value as 'CHEQUE' | 'DD')}>
                  <option value="CHEQUE">Cheque</option>
                  <option value="DD">Demand Draft</option>
                </select>
              </div>
              <div>
                <label>DOD amount ₹</label>
                <input type="number" value={dodAmount} onChange={(e) => setDodAmount(e.target.value)} placeholder="draft value" />
              </div>
            </>
          )}
        </div>
        {isDod && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            🔒 Delivery will be <strong>blocked</strong> until the {dodInstrument === 'DD' ? 'DD' : 'cheque'} is collected from the consignee and recorded.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Boxes ({pieces.length}) — each becomes a child label</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Actual (dead) kg</th><th>L (cm)</th><th>W (cm)</th><th>H (cm)</th><th>Vol kg (÷5000)</th><th></th></tr>
          </thead>
          <tbody>
            {pieces.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input value={p.deadKg} onChange={(e) => update(i, 'deadKg', e.target.value)} /></td>
                <td><input value={p.lengthCm} onChange={(e) => update(i, 'lengthCm', e.target.value)} /></td>
                <td><input value={p.widthCm} onChange={(e) => update(i, 'widthCm', e.target.value)} /></td>
                <td><input value={p.heightCm} onChange={(e) => update(i, 'heightCm', e.target.value)} /></td>
                <td><strong>{volOf(p) || '—'}</strong></td>
                <td>{pieces.length > 1 && <button className="secondary" onClick={() => removePiece(i)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button className="secondary" onClick={addPiece}>+ Add box</button>
          <div className="muted">Totals: dead <strong>{totalDead.toFixed(2)}</strong> kg · vol <strong>{totalVol.toFixed(2)}</strong> kg</div>
        </div>
      </div>

      <button onClick={submit} disabled={busy || !clientId || pieces.some((p) => !p.deadKg)}>
        {busy ? 'Creating…' : `Create AWB + ${pieces.length} child labels`}
      </button>
    </>
  );
}
