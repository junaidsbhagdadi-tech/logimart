import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/** Pickup-boy (DRIVER) mobile booking — book a shipment against a known credit customer from the
 *  field. Simplified single-column form; no payment (billed on the customer's cycle). */
export function PickupBook() {
  const [customers, setCustomers] = useState<{ id: string; legalName: string; accountCode: string }[]>([]);
  const [custQ, setCustQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [products, setProducts] = useState<{ code: string; name: string; attrs: any }[]>([]);
  const [f, setF] = useState({
    product: '', originPincode: '', destPincode: '', consigneeName: '', consigneePhone: '',
    consigneeAddress: '', consigneeCity: '', consigneeState: '', pieces: '1', deadKg: '', goodsDesc: '', referenceNo: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { api.listMaster('PRODUCT').then((r) => { setProducts(r as any); setF((x) => ({ ...x, product: x.product || r[0]?.code || '' })); }).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => api.bookingCustomers(custQ.trim() || undefined).then(setCustomers).catch(() => {}), 250); return () => clearTimeout(t); }, [custQ]);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const lookDest = (v: string) => { set('destPincode', v); if (/^\d{6}$/.test(v)) api.lookupPincode(v).then((p: any) => { if (p?.known) setF((x) => ({ ...x, consigneeCity: p.city || x.consigneeCity, consigneeState: p.state || x.consigneeState })); }).catch(() => {}); };

  const serviceModeFor = (code: string) => { const g = String(products.find((p) => p.code === code)?.attrs?.groupType || products.find((p) => p.code === code)?.attrs?.mode || '').toUpperCase(); return g.includes('AIR') || g.includes('APEX') ? 'AIR_ECONOMY' : g.includes('TRAIN') || g.includes('RAIL') ? 'RAIL' : 'ROAD_PTL'; };
  const custName = useMemo(() => customers.find((c) => c.id === clientId), [customers, clientId]);

  const book = async () => {
    setErr(''); setDone(null);
    if (!clientId) { setErr('Pick the customer.'); return; }
    if (!f.product) { setErr('Pick the product.'); return; }
    if (!(Number(f.deadKg) > 0)) { setErr('Enter the weight (kg).'); return; }
    if (!f.destPincode) { setErr('Enter the destination pincode.'); return; }
    const pcs = Math.max(1, Math.floor(Number(f.pieces) || 1));
    const total = Number(f.deadKg);
    setBusy(true);
    try {
      const r: any = await api.createShipment({
        clientId: Number(clientId), serviceMode: serviceModeFor(f.product),
        originZone: 'AUTO', destZone: 'AUTO', product: f.product,
        originPincode: f.originPincode || undefined, destPincode: f.destPincode,
        consigneeName: f.consigneeName || undefined, consigneePhone: f.consigneePhone || undefined,
        consigneeAddress: f.consigneeAddress || undefined, consigneeCity: f.consigneeCity || undefined, consigneeState: f.consigneeState || undefined,
        goodsDesc: f.goodsDesc || undefined, referenceNo: f.referenceNo || undefined,
        paymentTerm: 'PREPAID',
        pieces: Array.from({ length: pcs }, () => ({ deadKg: +(total / pcs).toFixed(3) })),
      });
      setDone(r.awb);
      setF((x) => ({ ...x, destPincode: '', consigneeName: '', consigneePhone: '', consigneeAddress: '', consigneeCity: '', consigneeState: '', pieces: '1', deadKg: '', goodsDesc: '', referenceNo: '' }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20 }}>📦 Pickup booking</h1>
      <p className="muted" style={{ marginTop: -10, fontSize: 13 }}>Book a shipment for a customer at pickup — billed to their account.</p>
      {err && <div className="error">{err}</div>}
      {done && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)' }}>✓ Booked <strong>{done}</strong>{custName ? ` for ${custName.legalName}` : ''}. <a href={`/shipments/${done}/awb-print`} target="_blank" rel="noreferrer">Print AWB</a></div>}

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div>
          <label>Customer *</label>
          <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Search name / code…" />
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ marginTop: 6 }}>
            <option value="">— pick customer —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.legalName} ({c.accountCode})</option>)}
          </select>
        </div>
        <div>
          <label>Product *</label>
          <select value={f.product} onChange={(e) => set('product', e.target.value)}>
            {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div className="grid cols-2" style={{ gap: 10 }}>
          <div><label>Origin PIN (pickup)</label><input value={f.originPincode} maxLength={6} onChange={(e) => set('originPincode', e.target.value)} placeholder="pickup pincode" /></div>
          <div><label>Dest PIN *</label><input value={f.destPincode} maxLength={6} onChange={(e) => lookDest(e.target.value)} placeholder="delivery pincode" /></div>
        </div>
        <div><label>Consignee name</label><input value={f.consigneeName} onChange={(e) => set('consigneeName', e.target.value)} /></div>
        <div className="grid cols-2" style={{ gap: 10 }}>
          <div><label>Consignee phone</label><input value={f.consigneePhone} onChange={(e) => set('consigneePhone', e.target.value)} /></div>
          <div><label>City</label><input value={f.consigneeCity} onChange={(e) => set('consigneeCity', e.target.value)} placeholder="auto from PIN" /></div>
        </div>
        <div><label>Consignee address</label><input value={f.consigneeAddress} onChange={(e) => set('consigneeAddress', e.target.value)} /></div>
        <div className="grid cols-2" style={{ gap: 10 }}>
          <div><label>Pieces</label><input type="number" value={f.pieces} onChange={(e) => set('pieces', e.target.value)} /></div>
          <div><label>Weight (kg) *</label><input type="number" value={f.deadKg} onChange={(e) => set('deadKg', e.target.value)} placeholder="total dead kg" /></div>
        </div>
        <div><label>Goods description</label><input value={f.goodsDesc} onChange={(e) => set('goodsDesc', e.target.value)} /></div>
        <div><label>Reference No.</label><input value={f.referenceNo} onChange={(e) => set('referenceNo', e.target.value)} placeholder="customer's ref (optional)" /></div>
        <button onClick={book} disabled={busy} style={{ padding: '12px', fontSize: 16 }}>{busy ? 'Booking…' : '📦 Book shipment'}</button>
      </div>
    </div>
  );
}
