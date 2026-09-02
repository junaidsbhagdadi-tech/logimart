import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Client } from '../api';
import { useAuth } from '../auth';
import { mapMode, modeLabel } from '../productMode';
import { expandCity } from '../lib/cityCodes';
import { ScanButton } from '../components/BarcodeScanner';

interface PieceForm { deadKg: string; lengthCm: string; widthCm: string; heightCm: string; }
const blank: PieceForm = { deadKg: '', lengthCm: '', widthCm: '', heightCm: '' };

const VOL_DIVISOR = 5000; // air default; surface uses the card's divisor + CFT (fetched per booking)

type PinInfo = Awaited<ReturnType<typeof api.lookupPincode>>;

export function CreateShipment() {
  const nav = useNavigate();
  const { user } = useAuth();
  const ownClientId = user?.clientId ? Number(user.clientId) : null;
  const isClient = user?.role === 'CLIENT_ADMIN'; // customers get a simplified form: no pricing/ops/carrier fields

  const [clients, setClients] = useState<Client[]>([]);
  // Accounts a client login may book under (own + same-GSTIN siblings); drives the account prefill/dropdown.
  const [accounts, setAccounts] = useState<any[]>([]);
  const [clientId, setClientId] = useState<number | ''>(ownClientId ?? '');
  const [custText, setCustText] = useState('');
  const [prodText, setProdText] = useState('');
  const [ftl, setFtl] = useState({ vehicleNo: '', ftlVehicleType: '32FT SXL', departureAt: '', arrivalAt: '' });

  const [originPin, setOriginPin] = useState('');
  const [destPin, setDestPin] = useState('');
  const [originInfo, setOriginInfo] = useState<PinInfo | null>(null);
  const [destInfo, setDestInfo] = useState<PinInfo | null>(null);
  const [destWarn, setDestWarn] = useState('');
  const [destBlocked, setDestBlocked] = useState(false); // dest pincode not in the master → block booking

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
  // Saved pickup warehouses for the selected customer (CustomerAddress rows flagged isWarehouse).
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [savingWh, setSavingWh] = useState(false);
  const loadWarehouses = (cid: number | string) => {
    if (!cid) { setWarehouses([]); return; }
    api.listAddr(String(cid)).then((rows) => setWarehouses((rows || []).filter((r: any) => r.isWarehouse))).catch(() => setWarehouses([]));
  };
  const applyWarehouse = (id: string) => {
    const w = warehouses.find((x) => String(x.id) === id);
    if (!w) return;
    setShp((p) => ({ ...p,
      shipperName: w.name ?? p.shipperName, shipperContact: w.designation ?? p.shipperContact,
      shipperAddress1: w.addressLine1 ?? '', shipperAddress2: w.addressLine2 ?? '',
      shipperPincode: w.pincode ?? '', shipperCity: w.city ?? '', shipperState: w.state ?? '',
      shipperPhone: w.landline ?? '', shipperMobile: w.mobile ?? '', shipperEmail: w.email ?? '',
      shipperGstin: w.gstNo ?? '', shipperCountry: w.country ?? 'India',
      originLocation: (w.city || p.originLocation) ?? '',
    }));
    if (w.pincode && String(w.pincode).length === 6) lookShipper(String(w.pincode));
  };
  const saveWarehouse = async () => {
    if (!clientId || !shp.shipperAddress1) return;
    const label = window.prompt('Save this pickup address as a warehouse for the customer. Name it:', shp.shipperCity || shp.shipperName || 'Warehouse');
    if (!label) return;
    setSavingWh(true);
    try {
      await api.addAddr(String(clientId), {
        contactType: 'Warehouse', isWarehouse: true, name: label, designation: shp.shipperContact,
        addressLine1: shp.shipperAddress1, addressLine2: shp.shipperAddress2, pincode: shp.shipperPincode,
        city: shp.shipperCity, state: shp.shipperState, country: shp.shipperCountry,
        mobile: shp.shipperMobile, landline: shp.shipperPhone, email: shp.shipperEmail, gstNo: shp.shipperGstin,
      });
      loadWarehouses(clientId);
    } catch { /* non-fatal */ } finally { setSavingWh(false); }
  };
  // services extras
  const [svc, setSvc] = useState({ vendor: 'SELF', service: 'SELF', shipmentValue: '', referenceNo: '', forwardingAwb: '', isCommercial: false, isMedical: false, bookedAt: '' });
  const [entryTab, setEntryTab] = useState<'AWB' | 'PROFORMA' | 'FORWARDING'>('AWB');
  const [flags, setFlags] = useState({ oda: false, appt: false });
  const [svcOptions, setSvcOptions] = useState<{ network: string; mode: string | null; tatDays: number | null; isOda: boolean }[]>([]);

  const [hubs, setHubs] = useState<{ id: string; code: string; name: string }[]>([]);
  const [originHubId, setOriginHubId] = useState<number | ''>('');
  const [destHubId, setDestHubId] = useState<number | ''>('');
  const [direct, setDirect] = useState(true); // #3 point-to-point routing (no hub) — default for walk-ins
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
  // Customer-facing ETA: fastest transit days among carriers serving the destination — shown
  // without any carrier/vendor names (clients never see who actually moves the shipment).
  // Only show carriers whose mode matches the selected product (surface product → surface carriers).
  const airProduct = /AIR/i.test(serviceMode);
  const carrierOptions = (() => {
    const m = svcOptions.filter((o) => { const mm = String(o.mode || '').toUpperCase(); return airProduct ? /AIR|EXP/.test(mm) : /SURF|ROAD|RAIL/.test(mm); });
    return m.length ? m : svcOptions;
  })();
  const clientEtaDays = (() => {
    const t = carrierOptions.map((o) => o.tatDays).filter((n): n is number => n != null);
    return t.length ? Math.min(...t) : null;
  })();
  // To-Pay applies only to reverse-pickup products.
  const isReverseProduct = ['TAPEX', 'TOSFC', 'TODP'].includes(String(product).toUpperCase());
  // Show the VENDOR name on carrier chips (not the raw "VENDOR-PRODUCT" network code).
  const vendorLabel = (network: string) => {
    const norm = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prefix = String(network || '').split('-')[0];
    const np = norm(prefix);
    const v = vendors.find((x) => {
      const nm = norm(x.name), cd = norm(x.vendorCode);
      return !!np && (cd === np || nm === np || (nm && nm.startsWith(np)) || (cd && np.startsWith(cd)));
    });
    return v ? v.name : prefix;
  };

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
  // Carrier rate comparison (staff): price every carrier for this booking, cheapest first.
  const [rateCompare, setRateCompare] = useState<{ vendor: string; total: number; freight: number }[] | null>(null);
  const [rcBusy, setRcBusy] = useState(false);
  const compareRates = async () => {
    if (!clientId || !product || !destPin) return;
    setRcBusy(true); setRateCompare(null);
    try {
      const totalDead = pieces.reduce((s, p) => s + (Number(p.deadKg) || 0), 0) || 0.5;
      const r = await api.carrierRates({ clientId, product, originPincode: originPin || undefined, destPincode: destPin, deadKg: totalDead, pcs: pieces.length, declaredValue: Number(svc.shipmentValue) || undefined });
      setRateCompare(r.options.map((o) => ({ vendor: o.vendor, total: o.total, freight: o.freight })));
    } catch { setRateCompare([]); }
    finally { setRcBusy(false); }
  };

  // ---- Draft autosave: keep the whole form in localStorage so navigating away
  // (e.g. to add a vendor / fix a pincode) and coming back never wipes the data. ----
  const DRAFT_KEY = 'lm_create_draft_v1';
  const [ready, setReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftSnapshot = () => ({
    clientId, custText, prodText, ftl, originPin, destPin, c, shp, svc, flags,
    originHubId, destHubId, direct, ewbNo, product, docType, chargeWeight, charges, chargeCode, chargeAmt,
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
        if (d.direct != null) setDirect(d.direct); else if (d.originHubId || d.destHubId) setDirect(false);
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
  // Client logins can't list all clients — fetch just the account(s) they may book under.
  useEffect(() => {
    if (!isClient) return;
    api.portalAccounts().then((rows) => {
      setAccounts(rows);
      // Default to the login's own account (or the only account) so the form is booking-ready.
      const own = rows.find((r) => String(r.id) === String(ownClientId)) ?? rows[0];
      if (own) setClientId(Number(own.id));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, ownClientId]);

  // Auto-fill shipper from the selected account's registered address (unless picking up elsewhere).
  // Staff read from the full clients list; client logins read from their bookable accounts.
  useEffect(() => {
    if (pickupElsewhere || clientId === '') return;
    const src = isClient ? accounts : clients;
    const cl: any = src.find((c: any) => String(c.id) === String(clientId));
    if (!cl) return;
    setShp((prev) => ({
      ...prev,
      shipperName: cl.legalName ?? '',
      shipperContact: (cl.contactPerson ?? cl.contactName) ?? '',
      shipperGstin: cl.gstin ?? '',
      shipperAddress1: cl.addressLine ?? '',
      shipperAddress2: cl.addressLine2 ?? prev.shipperAddress2,
      shipperPincode: cl.pincode ?? '',
      shipperCity: cl.city ?? '',
      shipperState: cl.state ?? cl.billingState ?? '',
      shipperPhone: cl.contactPhone ?? '',
      shipperEmail: cl.contactEmail ?? '',
      originLocation: cl.city ?? prev.originLocation,
    }));
    // Default the rating origin to the customer's pincode too, so the Booking origin field isn't blank
    // (staff can still override it — see lookOrigin, which then reflects back into the pickup detail).
    if (cl.pincode && String(cl.pincode) !== originPin) setOriginPin(String(cl.pincode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, pickupElsewhere, clients, accounts, isClient]);

  // Load the customer's saved pickup warehouses whenever the account changes.
  useEffect(() => { loadWarehouses(clientId); /* eslint-disable-next-line */ }, [clientId]);

  // For a client, the pickup address IS the origin of record — keep the origin pincode tied to the
  // shipper pincode (home address by default, or the "pickup elsewhere" address). This prevents a
  // booking origin (e.g. Delhi) from contradicting the actual pickup city (e.g. Mumbai).
  useEffect(() => {
    if (!isClient) return;
    if (shp.shipperPincode && shp.shipperPincode.length === 6 && shp.shipperPincode !== originPin) {
      lookOrigin(shp.shipperPincode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, shp.shipperPincode]);
  useEffect(() => { api.listVendors().then((v) => setVendors(v.filter((x: any) => x.isActive !== false))).catch(() => {}); }, []);
  // Re-pick the carrier to match the product's mode when the product changes (unless staff overrode it).
  useEffect(() => {
    if (vendorTouched || !svcOptions.length) return;
    const air = /AIR/i.test(serviceMode);
    const opts = svcOptions.filter((o) => { const mm = String(o.mode || '').toUpperCase(); return air ? /AIR|EXP/.test(mm) : /SURF|ROAD|RAIL/.test(mm); });
    const list = opts.length ? opts : svcOptions;
    // Keep SELF as the default — only re-pick a mode-matching carrier if a specific carrier was chosen.
    if (svc.vendor && svc.vendor !== 'SELF' && !list.some((o) => o.network === svc.vendor)) {
      const best = list.find((o) => /^BLUEDART/.test(o.network)) || list[0];
      if (best) setSvc((s) => ({ ...s, vendor: best.network, service: best.mode || s.service }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, svcOptions, vendorTouched, serviceMode]);
  // To-Pay is only valid for reverse products — force Prepaid otherwise.
  useEffect(() => { if (!isReverseProduct && paymentTerm === 'TO_PAY') setPaymentTerm('PREPAID'); }, [isReverseProduct, paymentTerm]);
  useEffect(() => {
    api.listHubs().then((hs) => {
      setHubs(hs);
      // Origin & destination hubs start BLANK — staff pick them (or they auto-derive from the pincode).
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

  // Auto-derive the serving hub from a pincode's zone/region (hubs carry a zone; pincodes carry region).
  const hubForRegion = (region?: string | null): number | '' => {
    if (!region) return '';
    const r = String(region).toUpperCase();
    const h = hubs.find((hb: any) => String(hb.zone || '').toUpperCase() === r || String(hb.name || '').toUpperCase().includes(r) || String(hb.code || '').toUpperCase() === r);
    return h ? Number(h.id) : '';
  };
  const lookOrigin = async (p: string) => {
    setOriginPin(p);
    if (/^\d{6}$/.test(p)) {
      const info = await api.lookupPincode(p).catch(() => null);
      setOriginInfo(info);
      // Auto-fetch the origin hub from the pincode's region (operator can still override / go Direct).
      const oh = hubForRegion(info?.region);
      if (oh) { setOriginHubId(oh); setDirect(false); }
      // Staff: reflect the entered origin pincode in the pickup (shipper) detail so the AWB's origin
      // isn't stuck on the customer's registered city — fixes "origin shows customer address even with
      // a different origin pincode". Address lines are left intact for the operator to adjust.
      if (info && !isClient) setShp((prev) => ({
        ...prev,
        shipperPincode: p,
        shipperCity: info.city ? expandCity(info.city) : prev.shipperCity,
        shipperState: info.state ?? prev.shipperState,
        originLocation: info.city ? expandCity(info.city) : prev.originLocation,
      }));
    } else setOriginInfo(null);
  };
  const lookDest = async (p: string) => {
    setDestPin(p);
    if (/^\d{6}$/.test(p)) {
      const info = await api.lookupPincode(p).catch(() => null);
      setDestInfo(info);
      // Auto-fetch the destination hub from the pincode's region (operator can still override / go Direct).
      const dh = hubForRegion(info?.region);
      if (dh) { setDestHubId(dh); setDirect(false); }
      // auto-fetch city + state from the pincode master (expand city code → full name)
      if (info) setC((prev) => ({ ...prev, consigneeCity: info.city ? expandCity(info.city) : prev.consigneeCity, consigneeState: info.state ?? prev.consigneeState }));
      // which carriers serve this pincode? (shown as chips + ETA; vendor stays SELF unless staff pick one)
      const opts = await api.serviceOptions(p).catch(() => []);
      setSvcOptions(opts);
      // ODA is a property of the destination area — auto-set it from the pincode directory OR any
      // serving network flagged ODA (not just whichever carrier happens to be fastest).
      const odaAuto = (info?.isOda ?? false) || opts.some((o) => o.isOda);
      setFlags((f) => ({ ...f, oda: odaAuto }));
      // Hard-block if the pincode isn't in the master; soft-warn if it's known but unserved.
      if (info && info.known === false) {
        setDestBlocked(true);
        setDestWarn('This pincode is not in the pincode master — booking is blocked. Add it under Pincodes first.');
      } else {
        setDestBlocked(false);
        setDestWarn(opts.length === 0 && info?.known
          ? 'In the pincode directory, but no serviceable network covers it — confirm serviceability before booking.'
          : '');
      }
    } else { setDestInfo(null); setSvcOptions([]); setDestWarn(''); setDestBlocked(false); }
  };

  const lookShipper = async (p: string) => {
    setS('shipperPincode', p);
    // The pickup pincode IS the rating origin — keep them tied so a changed pickup updates the origin.
    if (/^\d{6}$/.test(p)) {
      setOriginPin(p);
      const info = await api.lookupPincode(p).catch(() => null);
      if (info) { setOriginInfo(info); setShp((prev) => ({ ...prev, shipperCity: info.city ? expandCity(info.city) : prev.shipperCity, shipperState: info.state ?? prev.shipperState, originLocation: info.city ? expandCity(info.city) : prev.originLocation })); }
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
        isOda: flags.oda || (destInfo?.isOda ?? false) || svcOptions.some((o) => o.isOda),
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
        forwardingAwb: svc.forwardingAwb?.trim() || undefined,
        isCommercial: svc.isCommercial,
        isMedical: svc.isMedical,
        bookedAt: svc.bookedAt ? new Date(svc.bookedAt).toISOString() : undefined, // #2 manual book date+time
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
        // Only send chargeWeight when the operator EXPLICITLY overrode it — otherwise let the rate
        // engine compute it from the card (per-product divisor/cft + round-up to next kg). Auto-sending
        // the booking-time value was short-circuiting both (#7 round-off, #9 divisor for non-Apex).
        chargeWeight: cwTouched && chargeWeight ? +chargeWeight : undefined,
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
    info && (info.city || info.region) ? (
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {info.city ? <strong>{info.city}{info.state ? `, ${info.state}` : ''}</strong> : null}
        {info.region ? `${info.city ? ' · ' : ''}${info.region}` : ''}
        {info.tier ? ` · Tier ${info.tier}` : ''}{info.isOda ? ' · ODA' : ''}
      </div>
    ) : null;

  // #25 — the per-box volumetric preview must match what the engine bills: use the customer×product×
  // vendor card's actual divisor + CFT (surface uses CFT), not a hardcoded ÷5000.
  const [volCfg, setVolCfg] = useState<{ divisor: number; cft: number }>({ divisor: VOL_DIVISOR, cft: 0 });
  useEffect(() => {
    if (!clientId || !product) { setVolCfg({ divisor: VOL_DIVISOR, cft: 0 }); return; }
    let cancelled = false;
    api.volConfig(clientId, product, svc.vendor || undefined)
      .then((c) => { if (!cancelled) setVolCfg({ divisor: Number(c.divisor) || VOL_DIVISOR, cft: Number(c.cft) || 0 }); })
      .catch(() => { if (!cancelled) setVolCfg({ divisor: VOL_DIVISOR, cft: 0 }); });
    return () => { cancelled = true; };
  }, [clientId, product, svc.vendor]);
  const boxVol = (p: PieceForm) => {
    const l = +p.lengthCm, w = +p.widthCm, h = +p.heightCm;
    if (!(l && w && h)) return 0;
    const base = (l * w * h) / (volCfg.divisor || VOL_DIVISOR);
    return +(volCfg.cft > 0 ? base * volCfg.cft : base).toFixed(3);
  };
  const volLabel = volCfg.cft > 0 ? `÷${volCfg.divisor}×${volCfg.cft} CFT` : `÷${volCfg.divisor}`;

  const totalDead = pieces.reduce((s, p) => s + (+p.deadKg || 0), 0);
  const totalVol = pieces.reduce((s, p) => s + boxVol(p), 0);
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

      {/* Xpresion-style entry tabs: AWB (main) · Proforma (international) · Forwarding (vendor hand-off) */}
      <div className="row" style={{ gap: 4, marginTop: 14, borderBottom: '2px solid var(--line, #d7dadf)' }}>
        {([
          ['AWB', '📦 AWB', 'Shipper, consignee, services & charges, pieces, payment'],
          ['PROFORMA', '🧾 Proforma', 'International / customs invoice (enable later)'],
          ['FORWARDING', '🔀 Forwarding', "Vendor hand-off & forwarding AWB"],
        ] as const).map(([key, label, hint]) => (
          <button key={key} type="button" title={hint} onClick={() => setEntryTab(key)}
            className={entryTab === key ? '' : 'secondary'}
            style={{
              borderRadius: '8px 8px 0 0', padding: '9px 18px', fontWeight: 700, fontSize: 14,
              border: 'none', borderBottom: entryTab === key ? '3px solid var(--brand)' : '3px solid transparent',
              background: entryTab === key ? 'var(--surface, #fff)' : 'transparent',
              color: entryTab === key ? 'var(--brand)' : 'var(--muted)', boxShadow: 'none',
            }}>{label}</button>
        ))}
      </div>

      {entryTab === 'AWB' && (<>
      <div className="card" style={{ marginTop: 14 }}>
        <h2>Booking</h2>
        <div className="grid cols-3">
          {!isClient && (
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
          {/* Client login: their account is prefilled. Multiple account codes (same GSTIN) → pick one. */}
          {isClient && accounts.length > 1 && (
            <div>
              <label>Account *</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value ? +e.target.value : '')}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.legalName}</option>)}
              </select>
            </div>
          )}
          {isClient && accounts.length === 1 && (
            <div>
              <label>Account</label>
              <div style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', fontWeight: 600 }}>
                {accounts[0].accountCode} — {accounts[0].legalName}
              </div>
            </div>
          )}
          {isClient && accounts.length === 0 && (
            <div>
              <label>Account</label>
              <div style={{ padding: '9px 11px', border: '1px solid var(--warn, #e6a700)', borderRadius: 10, background: '#fff8e6', fontSize: 12 }}>
                Your login isn’t linked to a customer account yet — please ask your account manager to link it.
              </div>
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
          {/* Routing — internal; hidden from customers. #3: an explicit Direct (point-to-point) option
              for walk-ins, or route via hubs. Direct clears both hubs. */}
          {!isClient && (
            <div>
              <label>Routing</label>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className={direct ? '' : 'secondary'} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}
                  onClick={() => { setDirect(true); setOriginHubId(''); setDestHubId(''); }} title="Point-to-point — no hub routing">🎯 Direct (point-to-point)</button>
                <button type="button" className={!direct ? '' : 'secondary'} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}
                  onClick={() => setDirect(false)} disabled={hubs.length === 0} title={hubs.length === 0 ? 'No hubs configured' : 'Route through a hub'}>🏭 Via hub</button>
              </div>
            </div>
          )}
          {hubs.length > 0 && !isClient && !direct && (
            <>
              <div>
                <label>Origin hub</label>
                <select value={originHubId} onChange={(e) => setOriginHubId(e.target.value ? +e.target.value : '')}>
                  <option value="">— select origin hub —</option>
                  {hubs.map((hb) => <option key={hb.id} value={hb.id}>{hb.code} — {hb.name}</option>)}
                </select>
              </div>
              <div>
                <label>Destination hub</label>
                <select value={destHubId} onChange={(e) => setDestHubId(e.target.value ? +e.target.value : '')}>
                  <option value="">— select destination hub —</option>
                  {hubs.map((hb) => <option key={hb.id} value={hb.id}>{hb.code} — {hb.name}</option>)}
                </select>
              </div>
            </>
          )}
          {/* For a client the origin follows the pickup address (below) — no separate origin pincode. */}
          {!isClient && (
            <div>
              <label>Origin pincode</label>
              <input value={originPin} onChange={(e) => lookOrigin(e.target.value)} maxLength={6} placeholder="e.g. 560001" />
              {pinHint(originInfo)}
            </div>
          )}
          <div>
            <label>Destination pincode</label>
            <input value={destPin} onChange={(e) => lookDest(e.target.value)} maxLength={6} placeholder="e.g. 781001" />
            {pinHint(destInfo)}
            {flags.oda && <div style={{ fontSize: 11, marginTop: 4, fontWeight: 700, color: 'var(--warn, #b26a00)' }}>⚠ ODA — out-of-delivery-area (auto-detected)</div>}
            {destWarn && <div style={{ fontSize: 11.5, marginTop: 4, padding: '6px 8px', borderRadius: 8, background: '#fdecea', border: '1px solid #e0736a', color: '#a4291e' }}>⚠ {destWarn}</div>}
          </div>
        </div>
        {/* Clear origin → destination summary so the route is unambiguous at a glance. */}
        {(originInfo?.city || destInfo?.city || originPin || destPin || shp.originLocation || c.consigneeCity) && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2, #f1f3f6)', fontSize: 13.5, fontWeight: 700 }}>
            📍 <span style={{ color: 'var(--brand)' }}>{originInfo?.city || shp.originLocation || originPin || '—'}</span>
            {originInfo?.region ? <span className="muted" style={{ fontWeight: 400 }}> ({originInfo.region})</span> : null}
            <span style={{ margin: '0 8px', color: 'var(--muted)' }}>→</span>
            <span style={{ color: 'var(--green-2, #3f8a28)' }}>{destInfo?.city || c.consigneeCity || destPin || '—'}</span>
            {destInfo?.region ? <span className="muted" style={{ fontWeight: 400 }}> ({destInfo.region})</span> : null}
          </div>
        )}
        {/* Staff see the carrier products (they pick the vendor); clients see only the ETA. */}
        {!isClient && carrierOptions.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Carriers serving {destPin} — fastest auto-picked</div>
              <button type="button" className="secondary" style={{ padding: '3px 10px', fontSize: 11 }} disabled={rcBusy || !product || !destPin} onClick={compareRates} title="Price every carrier for this booking, cheapest first">{rcBusy ? 'Pricing…' : '₹ Compare rates'}</button>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {carrierOptions.map((o) => {
                const picked = o.network === svc.vendor;
                return (
                  <button key={o.network} type="button"
                    className={picked ? '' : 'secondary'}
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    title={o.network}
                    onClick={() => { setVendorTouched(true); setSvc((s) => ({ ...s, vendor: o.network, service: o.mode || s.service })); }}>
                    {vendorLabel(o.network)} · {o.mode ?? '—'} · {o.tatDays != null ? `${o.tatDays}d` : 'TAT ?'}{o.isOda ? ' · ODA' : ''}{picked ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
            {rateCompare && (
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>Rate comparison (incl. GST) — cheapest first</div>
                {rateCompare.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No priced carriers — check the rate cards for this customer × product.</div>}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {rateCompare.map((o, i) => {
                    const picked = o.vendor === svc.vendor;
                    return (
                      <button key={o.vendor} type="button" className={picked ? '' : 'secondary'} style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => { setVendorTouched(true); setSvc((s) => ({ ...s, vendor: o.vendor })); }}>
                        {i === 0 ? '⭐ ' : ''}{vendorLabel(o.vendor)} · ₹{o.total.toLocaleString('en-IN')}{picked ? ' ✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {isClient && product && clientEtaDays != null && (
          <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
            ⏱️ <strong>Estimated transit: {clientEtaDays} {clientEtaDays === 1 ? 'day' : 'days'}</strong>
            <span className="muted" style={{ fontSize: 12 }}> · {modeLabel(serviceMode)}{destInfo?.city ? ` to ${destInfo.city}` : ''}</span>
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
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {pickupElsewhere && !isClient && warehouses.length > 0 && (
              <select defaultValue="" onChange={(e) => { applyWarehouse(e.target.value); e.currentTarget.selectedIndex = 0; }} style={{ maxWidth: 220 }} title="Fill from a saved warehouse">
                <option value="">🏬 Pick a saved warehouse…</option>
                {warehouses.map((w) => <option key={String(w.id)} value={String(w.id)}>{w.name}{w.city ? ` — ${w.city}` : ''}</option>)}
              </select>
            )}
            {pickupElsewhere && !isClient && shp.shipperAddress1 && (
              <button type="button" className="secondary" disabled={savingWh} onClick={saveWarehouse} title="Save this pickup address to the customer for reuse">{savingWh ? 'Saving…' : '＋ Save as warehouse'}</button>
            )}
            <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600, fontSize: 13, cursor: 'pointer', margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={pickupElsewhere}
                onChange={(e) => { const v = e.target.checked; setPickupElsewhere(v); if (v) setShp((p) => ({ ...p, shipperName: '', shipperContact: '', shipperGstin: '', shipperAddress1: '', shipperAddress2: '', shipperPincode: '', shipperCity: '', shipperState: '', shipperPhone: '', shipperMobile: '', shipperEmail: '', originLocation: '' })); }} />
              🚚 Pickup out of home location
            </label>
          </div>
        </div>
        {/* Staff/walk-in: pickup detail stays editable (auto-filled from the customer, but override-able,
            e.g. a different origin). Only client-portal logins are locked to their registered address. */}
        <fieldset disabled={isClient && !pickupElsewhere && clientId !== ''} style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 'auto' }}>
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
          {!isClient && <div><label>Manual AWB <span className="muted">(pre-printed / hand-written — blank = auto)</span></label><div className="row" style={{ gap: 6 }}><input style={{ flex: 1 }} value={manualAwb} onChange={(e) => setManualAwb(e.target.value)} placeholder="e.g. 2030236" /><ScanButton title="Scan the AWB barcode" onScan={(c) => setManualAwb(c)} /></div></div>}
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
          {!isClient && <div><label>Booking date &amp; time <span className="muted" style={{ fontSize: 11 }}>(blank = now)</span></label><input type="datetime-local" value={svc.bookedAt} onChange={(e) => setSvc({ ...svc, bookedAt: e.target.value })} /></div>}
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
              {/* To-Pay is only for reverse-pickup products (TAPEX / TOSFC / TODP). */}
              {isReverseProduct && <option value="TO_PAY">To-Pay — collect freight from consignee</option>}
            </select>
            {!isReverseProduct && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>To-Pay is available only on reverse products (TAPEX / TOSFC / TODP).</div>}
          </div>
          {/* Freight amount is computed from the rate card — customers don't key it. Staff may. */}
          {paymentTerm === 'TO_PAY' && !isClient && (
            <div>
              <label>Freight to collect ₹</label>
              <input type="number" value={freightToCollect} onChange={(e) => setFreightToCollect(e.target.value)} placeholder="collected at delivery" />
            </div>
          )}
          <div style={{ gridColumn: (paymentTerm === 'TO_PAY' && !isClient) ? undefined : 'span 2' }}>
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
            <tr><th>#</th><th>Actual (dead) kg</th><th>L (cm)</th><th>W (cm)</th><th>H (cm)</th><th>Vol kg ({volLabel})</th><th></th></tr>
          </thead>
          <tbody>
            {pieces.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input value={p.deadKg} onChange={(e) => update(i, 'deadKg', e.target.value)} /></td>
                <td><input value={p.lengthCm} onChange={(e) => update(i, 'lengthCm', e.target.value)} /></td>
                <td><input value={p.widthCm} onChange={(e) => update(i, 'widthCm', e.target.value)} /></td>
                <td><input value={p.heightCm} onChange={(e) => update(i, 'heightCm', e.target.value)} /></td>
                <td><strong>{boxVol(p) || '—'}</strong></td>
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
      </>)}

      {entryTab === 'PROFORMA' && (
        <div className="card" style={{ marginTop: 14, borderLeft: '4px solid var(--brand)' }}>
          <h2>🧾 Proforma / International invoice</h2>
          <p className="muted" style={{ marginTop: -6 }}>
            For international (CSB/customs) shipments — manifest GST detail and per-box invoice lines (HSN, qty, value, IGST).
          </p>
          <div className="card" style={{ background: 'var(--surface-2, #f1f3f6)', textAlign: 'center', padding: '28px 20px' }}>
            <div style={{ fontSize: 30 }}>🌐</div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>Enabled for international shipments</div>
            <p className="muted" style={{ fontSize: 13, maxWidth: 460, margin: '6px auto 0' }}>
              This tab holds the customs proforma (Term of Invoice, Export Reason, HSN line items, IGST). It'll be switched on when international products go live — domestic AWBs don't need it.
            </p>
          </div>
        </div>
      )}

      {entryTab === 'FORWARDING' && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>🔀 Forwarding &amp; vendor hand-off</h2>
          <p className="muted" style={{ marginTop: -6 }}>
            When this AWB is handed to a delivery vendor, capture their carrier AWB and lane here. {isClient && 'Managed by the ExcelEx team.'}
          </p>
          {isClient ? (
            <div className="muted" style={{ fontSize: 13 }}>Forwarding details are handled by the ExcelEx operations team.</div>
          ) : (
            <div className="grid cols-3">
              <div>
                <label>Vendor <span className="muted">(SELF or code, e.g. BDR)</span></label>
                <input list="lm-fwd-vendors" value={svc.vendor} onChange={(e) => { setVendorTouched(true); setSvc({ ...svc, vendor: e.target.value.toUpperCase() }); }} placeholder="SELF or vendor code" />
                <datalist id="lm-fwd-vendors">{vendors.map((v) => <option key={v.id} value={(v.vendorCode || v.name).toUpperCase()}>{v.vendorCode} — {v.name}</option>)}</datalist>
              </div>
              <div>
                <label>Service</label>
                <input value={svc.service} onChange={(e) => setSvc({ ...svc, service: e.target.value })} placeholder="SELF / DHL / …" />
              </div>
              <div>
                <label>Forwarding AWB <span className="muted">(vendor's carrier AWB)</span></label>
                <div className="row" style={{ gap: 6 }}><input style={{ flex: 1 }} value={svc.forwardingAwb} onChange={(e) => setSvc({ ...svc, forwardingAwb: e.target.value })} placeholder="e.g. 58001396353" /><ScanButton title="Scan the forwarding barcode" onScan={(c) => setSvc({ ...svc, forwardingAwb: c })} /></div>
              </div>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Vendor cost isn't captured here — margins come from the uploaded vendor bill.</p>
        </div>
      )}

      <button style={{ marginTop: 16 }} onClick={submit} disabled={busy || !clientId || destBlocked || pieces.some((p) => !p.deadKg)}>
        {busy ? 'Creating…' : destBlocked ? 'Destination pincode not serviceable' : `Create AWB + ${pieces.length} child labels`}
      </button>
    </>
  );
}
