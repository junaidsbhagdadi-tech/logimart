import { useEffect, useMemo, useState } from 'react';
import { api, Client } from '../api';

// Zones as columns (billing-app layout)
const ZONES = ['NORTH', 'EAST', 'WEST', 'SOUTH', 'NORTHEAST'] as const;
type Zone = (typeof ZONES)[number];
type SlabRow = { label: string; rateType: 'INITIAL' | 'PLUSKG'; upperLimitG: string; rates: Record<Zone, string> };

const emptyRates = () => ZONES.reduce((o, z) => ({ ...o, [z]: '' }), {} as Record<Zone, string>);

export function RateCard() {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // header
  const [clientId, setClientId] = useState('');
  const [productType, setProductType] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [rateType, setRateType] = useState('PER_UNIT');
  const [minChargeableG, setMinChargeableG] = useState('500');
  const [additionalUnitG, setAdditionalUnitG] = useState('1000');
  const [volumetricDivisor, setVolumetricDivisor] = useState('5000');
  const [fuelPct, setFuelPct] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');

  // zone × weight-slab grid — First (INITIAL) + Additional 1kg (PLUSKG)
  const [slabs, setSlabs] = useState<SlabRow[]>([
    { label: 'First slab', rateType: 'INITIAL', upperLimitG: '500', rates: emptyRates() },
    { label: 'Add. 1kg (unlimited)', rateType: 'PLUSKG', upperLimitG: '', rates: emptyRates() },
  ]);

  // add-on charges
  const [fovPct, setFovPct] = useState('');
  const [fovMin, setFovMin] = useState('');
  const [oda, setOda] = useState('');
  const [appt, setAppt] = useState('');

  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
    api.listMaster('PRODUCT').then((r) => setProducts(r.map((x) => ({ code: x.code, name: x.name })))).catch(() => {});
  }, []);

  const setRate = (i: number, z: Zone, v: string) => setSlabs((s) => s.map((row, idx) => (idx === i ? { ...row, rates: { ...row.rates, [z]: v } } : row)));
  const setLimit = (i: number, v: string) => setSlabs((s) => s.map((row, idx) => (idx === i ? { ...row, upperLimitG: v } : row)));
  const addSlab = () => setSlabs((s) => [...s, { label: `Slab ${s.length}`, rateType: 'PLUSKG', upperLimitG: '', rates: emptyRates() }]);
  const removeSlab = (i: number) => setSlabs((s) => s.filter((_, idx) => idx !== i));

  const clientName = useMemo(() => clients.find((c) => String(c.id) === clientId)?.legalName, [clients, clientId]);

  const create = async () => {
    setError(''); setMsg('');
    if (!clientId) { setError('Select a customer.'); return; }
    if (!productType) { setError('Select a product type.'); return; }
    setBusy(true);
    try {
      const cid = clientId;
      const from = validFrom ? new Date(validFrom).toISOString() : undefined;
      let slabCount = 0;
      // grid → INITIAL/PLUSKG slabs per zone
      for (const row of slabs) {
        const weightKg = row.rateType === 'INITIAL'
          ? (Number(row.upperLimitG || minChargeableG) / 1000)
          : (Number(additionalUnitG) / 1000);
        for (const z of ZONES) {
          const rate = row.rates[z];
          if (rate && Number(rate) > 0) {
            await api.addRateSlab({ clientId: Number(cid), product: productType, service: serviceType || undefined, zone: z, rateType: row.rateType, weight: weightKg, rate: Number(rate), unit: 'KG', fromDate: from });
            slabCount++;
          }
        }
      }
      // header add-ons → existing per-customer config
      if (fuelPct && Number(fuelPct) > 0) await api.addFuel(cid, { mode: 'FLAT', percentage: Number(fuelPct), product: productType, service: serviceType || undefined });
      if ((fovPct && Number(fovPct) > 0) || (fovMin && Number(fovMin) > 0)) await api.addCharge(cid, { chargeDesc: 'FREIGHT ON VALUE', value: Number(fovPct || 0), minimumValue: fovMin ? Number(fovMin) : undefined, product: productType, service: serviceType || undefined });
      if (oda && Number(oda) > 0) await api.addCharge(cid, { chargeDesc: 'EXTRA DELIVERY LOCATION', value: Number(oda), product: productType, service: serviceType || undefined });
      if (appt && Number(appt) > 0) await api.addCharge(cid, { chargeDesc: 'APPOINTMENT DELIVERY', value: Number(appt), product: productType, service: serviceType || undefined });
      if (volumetricDivisor && Number(volumetricDivisor) > 0) await api.addVol(cid, { product: productType, service: serviceType || undefined, cmDivide: Number(volumetricDivisor), cft: 1, inchDivide: 0 });

      setMsg(`✓ Rate card created for ${clientName} — ${productType}${serviceType ? '/' + serviceType : ''}: ${slabCount} zone-slab rate(s), fuel/FOV/ODA/volumetric applied.`);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  return (
    <>
      <h1>💱 New Rate Card</h1>
      <p className="muted" style={{ marginTop: -14 }}>Configure freight rates for each zone and weight slab.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <div className="grid cols-3">
          <div>
            <label>Customer *</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select customer</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
            </select>
          </div>
          <div>
            <label>Product Type *</label>
            <select value={productType} onChange={(e) => setProductType(e.target.value)}>
              <option value="">Select product</option>
              {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label>Service Type</label>
            <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              <option value="">—</option><option>AIR</option><option>SURFACE</option><option>NDD</option><option>SDD</option>
            </select>
          </div>

          <div>
            <label>Rate Type</label>
            <select value={rateType} onChange={(e) => setRateType(e.target.value)}>
              <option value="PER_UNIT">Per Unit — rate × weight units</option>
            </select>
          </div>
          <div><label>Min Chargeable Weight (g)</label><input type="number" value={minChargeableG} onChange={(e) => setMinChargeableG(e.target.value)} /></div>
          <div><label>Additional Weight Unit (g) <span className="muted">per extra unit after first slab</span></label><input type="number" value={additionalUnitG} onChange={(e) => setAdditionalUnitG(e.target.value)} /></div>

          <div>
            <label>Volumetric Divisor</label>
            <select value={volumetricDivisor} onChange={(e) => setVolumetricDivisor(e.target.value)}>
              <option value="5000">5000 (Domestic Standard)</option><option value="4750">4750</option><option value="6000">6000</option><option value="28317">28317 (CFT cm³)</option>
            </select>
          </div>
          <div><label>Fuel Surcharge <span className="muted">(whole %, e.g. 18)</span></label><input type="number" value={fuelPct} onChange={(e) => setFuelPct(e.target.value)} /></div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div><label>Valid From <span className="muted">(opt.)</span></label><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div>
            <div><label>Valid To <span className="muted">(opt.)</span></label><input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Zone × Weight Slab Rates — ₹</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr><th>Weight Slab</th><th>Upper Limit (g)</th>{ZONES.map((z) => <th key={z} style={{ textTransform: 'capitalize' }}>{z.toLowerCase()}</th>)}<th></th></tr>
            </thead>
            <tbody>
              {slabs.map((row, i) => (
                <tr key={i}>
                  <td><strong>{row.label}</strong><div className="muted" style={{ fontSize: 11 }}>{row.rateType === 'INITIAL' ? 'INITIAL' : 'PLUSKG'}</div></td>
                  <td>{row.rateType === 'PLUSKG' ? <span className="muted">∞</span> : <input type="number" value={row.upperLimitG} onChange={(e) => setLimit(i, e.target.value)} style={{ width: 90 }} />}</td>
                  {ZONES.map((z) => <td key={z}><input type="number" value={row.rates[z]} onChange={(e) => setRate(i, z, e.target.value)} style={{ width: 80 }} placeholder="0" /></td>)}
                  <td>{i > 1 && <button className="secondary" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => removeSlab(i)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="secondary" onClick={addSlab}>＋ Add Slab</button></div>
      </div>

      <div className="card">
        <h2>Add-on Charges</h2>
        <div className="grid cols-4">
          <div><label>FOV Charge (%)</label><input type="number" value={fovPct} onChange={(e) => setFovPct(e.target.value)} placeholder="optional" /></div>
          <div><label>FOV Minimum (₹)</label><input type="number" value={fovMin} onChange={(e) => setFovMin(e.target.value)} placeholder="optional" /></div>
          <div><label>ODA Charge (₹)</label><input type="number" value={oda} onChange={(e) => setOda(e.target.value)} placeholder="optional" /></div>
          <div><label>Appointment Delivery (₹)</label><input type="number" value={appt} onChange={(e) => setAppt(e.target.value)} placeholder="optional" /></div>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={create} disabled={busy || !clientId || !productType}>{busy ? 'Creating…' : 'Create Rate Card'}</button>
        </div>
      </div>
    </>
  );
}
