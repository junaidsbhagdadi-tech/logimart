import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const MODES = [
  { code: 'EXPRESS', label: 'International Express' },
  { code: 'AIR_FREIGHT', label: 'Air Freight' },
  { code: 'OCEAN_FCL', label: 'Ocean FCL' },
  { code: 'OCEAN_LCL', label: 'Ocean LCL' },
];
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const CONTAINERS = ['20GP', '40GP', '40HC', '45HC', '20RF', '40RF'];
const blankPkg = () => ({ count: '1', lengthCm: '', widthCm: '', heightCm: '', weightKg: '', description: '' });

export function IntlBook() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<{ id: string; legalName: string; accountCode: string }[]>([]);
  const [custQ, setCustQ] = useState('');
  const [f, setF] = useState<any>({
    mode: 'EXPRESS', direction: 'EXPORT', clientId: '', incoterm: 'FOB', serviceLevel: '', currency: 'USD',
    shipperName: '', shipperAddress: '', shipperCity: '', shipperCountry: 'India', shipperContact: '',
    consigneeName: '', consigneeAddress: '', consigneeCity: '', consigneeCountry: '', consigneeContact: '',
    originCountry: 'India', originPort: '', destCountry: '', destPort: '', carrier: '',
    houseNo: '', masterNo: '', containerNo: '', containerType: '40HC', vesselVoyage: '',
    grossWeightKg: '', declaredValue: '', goodsDesc: '', hsCode: '', marksNumbers: '', etd: '', eta: '', remarks: '',
  });
  const [pkgs, setPkgs] = useState<any[]>([blankPkg()]);
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { const t = setTimeout(() => api.bookingCustomers(custQ.trim() || undefined).then(setCustomers).catch(() => {}), 250); return () => clearTimeout(t); }, [custQ]);
  const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  const setPkg = (i: number, k: string, v: string) => setPkgs((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const isOcean = f.mode === 'OCEAN_FCL' || f.mode === 'OCEAN_LCL';
  const isFcl = f.mode === 'OCEAN_FCL';

  const pkgPayload = () => pkgs.filter((p) => Number(p.count) > 0).map((p) => ({ count: Number(p.count) || 1, lengthCm: p.lengthCm ? Number(p.lengthCm) : undefined, widthCm: p.widthCm ? Number(p.widthCm) : undefined, heightCm: p.heightCm ? Number(p.heightCm) : undefined, weightKg: p.weightKg ? Number(p.weightKg) : undefined, description: p.description || undefined }));

  const doQuote = async () => {
    setErr(''); setQuote(null);
    try {
      const r = await api.intlQuote({ mode: f.mode, clientId: f.clientId ? Number(f.clientId) : undefined, originCountry: f.originCountry, destCountry: f.destCountry, grossWeightKg: f.grossWeightKg ? Number(f.grossWeightKg) : undefined, containers: isFcl ? (Number(pkgs[0]?.count) || 1) : undefined, packages: pkgPayload() });
      setQuote(r);
    } catch (e: any) { setErr(e.message); }
  };

  const book = async () => {
    setErr('');
    if (!f.clientId) { setErr('Pick the customer.'); return; }
    if (!f.destCountry) { setErr('Enter the destination country.'); return; }
    setBusy(true);
    try {
      const r = await api.intlCreate({ ...f, clientId: Number(f.clientId), grossWeightKg: f.grossWeightKg ? Number(f.grossWeightKg) : undefined, declaredValue: f.declaredValue ? Number(f.declaredValue) : undefined, etd: f.etd || undefined, eta: f.eta || undefined, packages: pkgPayload() });
      nav(`/intl/${r.jobNo}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const modeLabel = useMemo(() => MODES.find((m) => m.code === f.mode)?.label, [f.mode]);

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>🌍 Book International — {modeLabel}</h1>
      {err && <div className="error">{err}</div>}

      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="grid cols-4" style={{ gap: 12 }}>
          <div><label>Mode *</label><select value={f.mode} onChange={(e) => { set('mode', e.target.value); setQuote(null); }}>{MODES.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select></div>
          <div><label>Direction</label><select value={f.direction} onChange={(e) => set('direction', e.target.value)}><option>EXPORT</option><option>IMPORT</option></select></div>
          <div>
            <label>Customer *</label>
            <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="search name / code…" />
            <select value={f.clientId} onChange={(e) => set('clientId', e.target.value)} style={{ marginTop: 6 }}>
              <option value="">— pick —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.legalName} ({c.accountCode})</option>)}
            </select>
          </div>
          <div><label>Incoterm</label><select value={f.incoterm} onChange={(e) => set('incoterm', e.target.value)}><option value="">—</option>{INCOTERMS.map((i) => <option key={i} value={i}>{i}</option>)}</select></div>
        </div>

        <fieldset style={{ border: '1px solid var(--line, #d7dadf)', borderRadius: 8, padding: 12 }}>
          <legend style={{ fontWeight: 600, fontSize: 13 }}>Shipper</legend>
          <div className="grid cols-4" style={{ gap: 10 }}>
            <div><label>Name</label><input value={f.shipperName} onChange={(e) => set('shipperName', e.target.value)} /></div>
            <div><label>Contact</label><input value={f.shipperContact} onChange={(e) => set('shipperContact', e.target.value)} /></div>
            <div><label>City</label><input value={f.shipperCity} onChange={(e) => set('shipperCity', e.target.value)} /></div>
            <div><label>Country</label><input value={f.shipperCountry} onChange={(e) => set('shipperCountry', e.target.value)} /></div>
            <div style={{ gridColumn: 'span 4' }}><label>Address</label><input value={f.shipperAddress} onChange={(e) => set('shipperAddress', e.target.value)} /></div>
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--line, #d7dadf)', borderRadius: 8, padding: 12 }}>
          <legend style={{ fontWeight: 600, fontSize: 13 }}>Consignee</legend>
          <div className="grid cols-4" style={{ gap: 10 }}>
            <div><label>Name</label><input value={f.consigneeName} onChange={(e) => set('consigneeName', e.target.value)} /></div>
            <div><label>Contact</label><input value={f.consigneeContact} onChange={(e) => set('consigneeContact', e.target.value)} /></div>
            <div><label>City</label><input value={f.consigneeCity} onChange={(e) => set('consigneeCity', e.target.value)} /></div>
            <div><label>Country *</label><input value={f.consigneeCountry} onChange={(e) => { set('consigneeCountry', e.target.value); set('destCountry', e.target.value); }} /></div>
            <div style={{ gridColumn: 'span 4' }}><label>Address</label><input value={f.consigneeAddress} onChange={(e) => set('consigneeAddress', e.target.value)} /></div>
          </div>
        </fieldset>

        <div className="grid cols-4" style={{ gap: 12 }}>
          <div><label>Origin country</label><input value={f.originCountry} onChange={(e) => set('originCountry', e.target.value)} /></div>
          <div><label>{isOcean ? 'Origin port' : 'Origin (airport/city)'}</label><input value={f.originPort} onChange={(e) => set('originPort', e.target.value)} /></div>
          <div><label>Dest country *</label><input value={f.destCountry} onChange={(e) => set('destCountry', e.target.value)} /></div>
          <div><label>{isOcean ? 'Dest port' : 'Dest (airport/city)'}</label><input value={f.destPort} onChange={(e) => set('destPort', e.target.value)} /></div>
          <div><label>{isOcean ? 'Shipping line' : f.mode === 'AIR_FREIGHT' ? 'Airline' : 'Carrier'}</label><input value={f.carrier} onChange={(e) => set('carrier', e.target.value)} /></div>
          <div><label>{isOcean ? 'HBL' : 'HAWB'} no.</label><input value={f.houseNo} onChange={(e) => set('houseNo', e.target.value)} /></div>
          <div><label>{isOcean ? 'MBL' : 'MAWB'} no.</label><input value={f.masterNo} onChange={(e) => set('masterNo', e.target.value)} /></div>
          <div><label>Service level</label><input value={f.serviceLevel} onChange={(e) => set('serviceLevel', e.target.value)} placeholder={f.mode === 'EXPRESS' ? 'e.g. Express Worldwide' : 'e.g. Direct / Console'} /></div>
          {isOcean && <>
            <div><label>Container no.</label><input value={f.containerNo} onChange={(e) => set('containerNo', e.target.value)} /></div>
            {isFcl && <div><label>Container type</label><select value={f.containerType} onChange={(e) => set('containerType', e.target.value)}>{CONTAINERS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>}
            <div><label>Vessel / voyage</label><input value={f.vesselVoyage} onChange={(e) => set('vesselVoyage', e.target.value)} /></div>
          </>}
        </div>

        <fieldset style={{ border: '1px solid var(--line, #d7dadf)', borderRadius: 8, padding: 12 }}>
          <legend style={{ fontWeight: 600, fontSize: 13 }}>Cargo{isFcl ? ' — rows = containers' : ' — packages'}</legend>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>{isFcl ? 'Containers' : 'Pcs'}</th><th>L cm</th><th>W cm</th><th>H cm</th><th>Weight kg</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {pkgs.map((p, i) => (
                <tr key={i}>
                  <td><input type="number" style={{ width: 60 }} value={p.count} onChange={(e) => setPkg(i, 'count', e.target.value)} /></td>
                  <td><input type="number" style={{ width: 64 }} value={p.lengthCm} onChange={(e) => setPkg(i, 'lengthCm', e.target.value)} /></td>
                  <td><input type="number" style={{ width: 64 }} value={p.widthCm} onChange={(e) => setPkg(i, 'widthCm', e.target.value)} /></td>
                  <td><input type="number" style={{ width: 64 }} value={p.heightCm} onChange={(e) => setPkg(i, 'heightCm', e.target.value)} /></td>
                  <td><input type="number" style={{ width: 80 }} value={p.weightKg} onChange={(e) => setPkg(i, 'weightKg', e.target.value)} /></td>
                  <td><input value={p.description} onChange={(e) => setPkg(i, 'description', e.target.value)} /></td>
                  <td>{pkgs.length > 1 && <button className="secondary" style={{ padding: '2px 8px' }} onClick={() => setPkgs((ps) => ps.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="secondary" style={{ marginTop: 8, padding: '4px 12px' }} onClick={() => setPkgs((ps) => [...ps, blankPkg()])}>＋ Add row</button>
          <div className="grid cols-4" style={{ gap: 10, marginTop: 10 }}>
            <div><label>Total gross kg <span className="muted">(blank = sum of rows)</span></label><input type="number" value={f.grossWeightKg} onChange={(e) => set('grossWeightKg', e.target.value)} /></div>
            <div><label>Declared value</label><input type="number" value={f.declaredValue} onChange={(e) => set('declaredValue', e.target.value)} /></div>
            <div><label>Currency</label><input value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></div>
            <div><label>HS code</label><input value={f.hsCode} onChange={(e) => set('hsCode', e.target.value)} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Goods description</label><input value={f.goodsDesc} onChange={(e) => set('goodsDesc', e.target.value)} /></div>
            <div><label>Marks & numbers</label><input value={f.marksNumbers} onChange={(e) => set('marksNumbers', e.target.value)} /></div>
          </div>
        </fieldset>

        <div className="grid cols-4" style={{ gap: 12 }}>
          <div><label>ETD</label><input type="date" value={f.etd} onChange={(e) => set('etd', e.target.value)} /></div>
          <div><label>ETA</label><input type="date" value={f.eta} onChange={(e) => set('eta', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Remarks</label><input value={f.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
        </div>

        {quote && (
          <div className="card" style={{ background: 'var(--bg-soft, #f1f3f6)', borderLeft: `4px solid ${quote.quoted ? 'var(--ok, #16a34a)' : 'var(--warn, #d97706)'}` }}>
            {quote.quoted
              ? <span><strong>Quote:</strong> {quote.currency} {quote.total?.toLocaleString()} <span className="muted">({quote.basis}{quote.fuelPct ? ` + ${quote.fuelPct}% fuel` : ''}; card: {quote.rateCard})</span> · chargeable {quote.chargeableWeightKg} kg{quote.volumeCbm ? `, ${quote.volumeCbm} CBM` : ''}</span>
              : <span className="muted">⚠ {quote.reason} — chargeable {quote.chargeableWeightKg} kg{quote.volumeCbm ? `, ${quote.volumeCbm} CBM` : ''}. Add a rate card under <strong>Intl Rate Cards</strong>.</span>}
          </div>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button className="secondary" onClick={doQuote}>💱 Quote freight</button>
          <button onClick={book} disabled={busy}>{busy ? 'Booking…' : '🌍 Book international job'}</button>
        </div>
      </div>
    </div>
  );
}
