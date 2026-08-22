import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ParseResult } from '../lib/rateSheet'; // value fns are lazy-imported (keeps xlsx out of the main bundle)

// Cargo slab types (₹/kg style) vs courier/DP slab types (gram-banded).
const SLAB_TYPES = ['INITIAL', 'UPTO', 'ADDITIONAL', 'PLUS', 'PLUSKG'];
const COURIER_SLAB_TYPES = ['FIRST250', 'FIRST500', 'ADD500'];
const COURIER_ZONES = ['A', 'B', 'C', 'OTHER'];
// DP / TDD / NDD price on gram slabs × A/B/C/OTHER zones; everything else is cargo (₹/kg × wide zone matrix).
const COURIER_PRODUCTS = new Set(['DP', 'TDD', 'NDD']);
const isCourierProduct = (code: any) => COURIER_PRODUCTS.has(String(code ?? '').toUpperCase());
// Fixed weight (kg) implied by each courier slab type.
const COURIER_SLAB_KG: Record<string, string> = { FIRST250: '0.25', FIRST500: '0.5', ADD500: '0.5' };
const num = (v: any) => (v != null && v !== '' ? Number(v) : 0);
const money = (v: any) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

type Client = { id: string | number; legalName: string; accountCode?: string };

/** Popout: all of a customer's rate cards (grouped by network), each with a charges
 *  strip + zone×slab matrix. Add / edit / delete inline. */
export function RateCardsDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const [cards, setCards] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [mechs, setMechs] = useState<any[]>([]);
  const [chargeMaster, setChargeMaster] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null); // card object, or { _new: true }
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api.listCustomerCards(client.id).then(setCards).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.listMaster('PRODUCT').then(setProducts).catch(() => {});
    api.listMaster('ZONE').then((z) => setZones(z.map((x) => x.code))).catch(() => {});
    api.listVendors().then((v) => setVendors(v.filter((x) => x.isActive !== false))).catch(() => {});
    api.listMaster('FUEL_MECHANISM').then(setMechs).catch(() => {});
    api.listMaster('CHARGE').then(setChargeMaster).catch(() => {});
  }, [client.id]);

  const del = async (id: string) => {
    if (!confirm('Delete this rate card?')) return;
    try { await api.delCustomerCard(id); load(); } catch (e: any) { setErr(e.message); }
  };

  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const c of cards) { const k = c.network || 'SELF'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(c); }
    return [...m.entries()];
  }, [cards]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ width: 1040, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>💳 Rate Cards — {client.legalName}</h2>
          <button className="secondary" onClick={onClose} style={{ padding: '4px 12px' }}>✕ Close</button>
        </div>
        {err && <div className="error">{err}</div>}

        {editing ? (
          <RateCardEditor
            client={client} card={editing._new ? null : editing}
            products={products} zones={zones.length ? zones : ['N', 'E', 'W', 'S', 'NE1']} vendors={vendors} mechs={mechs} chargeMaster={chargeMaster}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        ) : uploading ? (
          <RateUpload client={client} products={products} vendors={vendors} onCancel={() => setUploading(false)} onSaved={() => { setUploading(false); load(); }} />
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
              <button className="secondary" onClick={async () => { (await import('../lib/rateSheet')).downloadCourierTemplate(); }}>⬇ DP/Courier template</button>
              <button className="secondary" onClick={async () => { (await import('../lib/rateSheet')).downloadCargoTemplate(); }}>⬇ Cargo template</button>
              <button className="secondary" onClick={() => setUploading(true)}>⬆ Upload rates</button>
              <button onClick={() => setEditing({ _new: true })}>＋ Add Rate Card</button>
            </div>
            {!cards.length && <p className="muted">No rate cards yet. Click “Add Rate Card” to create one per network (SELF / vendor) &amp; product.</p>}
            {grouped.map(([network, list]) => (
              <div key={network} style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: .3, color: 'var(--muted)', margin: '4px 0 8px' }}>
                  {network === 'SELF' ? '🏠 SELF NETWORK' : `🚚 ${network}`}
                </div>
                {list.map((c) => <CardView key={c.id} card={c} zones={zones} onEdit={() => setEditing(c)} onDelete={() => del(c.id)} />)}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Read-only card: charges chip-strip + zone × slab matrix. */
function CardView({ card, zones, onEdit, onDelete }: { card: any; zones: string[]; onEdit: () => void; onDelete: () => void }) {
  const cols = useMemo(() => {
    const zs = new Set<string>(zones);
    (card.slabs || []).forEach((s: any) => zs.add(s.zone));
    return [...zs];
  }, [card, zones]);
  // rows keyed by rateType+weight
  const rows = useMemo(() => {
    const m = new Map<string, any>();
    (card.slabs || []).forEach((s: any) => {
      const k = `${s.rateType}|${s.weight}`;
      if (!m.has(k)) m.set(k, { rateType: s.rateType, weight: s.weight, rates: {} as Record<string, any> });
      m.get(k).rates[s.zone] = s.rate;
    });
    return [...m.values()].sort((a, b) => a.rateType.localeCompare(b.rateType) || Number(a.weight) - Number(b.weight));
  }, [card]);

  const chips: { k: string; v: string }[] = [];
  chips.push(card.fuelMode === 'DYNAMIC'
    ? { k: 'Diesel', v: `Indexed${card.fuelMechanism ? ` (${card.fuelMechanism})` : ''}` }
    : { k: 'Fuel', v: `${num(card.fuelPct)}%` });
  if (num(card.fovPct) || num(card.fovMin)) chips.push({ k: 'FOV', v: `${num(card.fovPct)}%${num(card.fovMin) ? ` · min ${money(card.fovMin)}` : ''}` });
  if (num(card.odaFlat) || num(card.odaPerKg) || num(card.odaMin)) chips.push({ k: 'ODA', v: `${money(card.odaFlat)}${num(card.odaPerKg) ? ` +${money(card.odaPerKg)}/kg` : ''}${num(card.odaMin) ? ` · min ${money(card.odaMin)}` : ''}` });
  if (num(card.topayCharge)) chips.push({ k: 'To-Pay', v: money(card.topayCharge) });
  if (num(card.apptCharge)) chips.push({ k: 'Appt', v: money(card.apptCharge) });
  if (num(card.loadingCharge)) chips.push({ k: 'Loading', v: money(card.loadingCharge) });
  if (num(card.unloadingCharge)) chips.push({ k: 'Unloading', v: money(card.unloadingCharge) });
  if (num(card.docketCharge)) chips.push({ k: 'Docket', v: money(card.docketCharge) });
  chips.push({ k: 'Vol÷', v: String(num(card.volumetricDivisor)) });
  if (num(card.cft)) chips.push({ k: 'CFT', v: String(num(card.cft)) });
  if (num(card.minFreight)) chips.push({ k: 'Min freight', v: money(card.minFreight) });

  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ fontSize: 15 }}>{card.product}</strong>
          {card.mode && <span className="badge CREATED" style={{ marginLeft: 8 }}>{card.mode}</span>}
          {card.service && <span className="badge" style={{ marginLeft: 6, background: '#eef', color: '#446' }}>{card.service}</span>}
          {card.isActive === false && <span className="badge CANCELLED" style={{ marginLeft: 6 }}>INACTIVE</span>}
          {card.label && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{card.label}</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={onEdit}>✎ Edit</button>
          <button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={onDelete}>🗑</button>
        </div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {chips.map((c, i) => (
          <span key={i} style={{ fontSize: 11.5, background: 'var(--bg-soft, #f2f4f7)', border: '1px solid #e2e6ec', borderRadius: 8, padding: '3px 9px' }}>
            <b style={{ color: 'var(--muted)' }}>{c.k}:</b> {c.v}
          </span>
        ))}
      </div>

      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>Slab</th><th>Upto/Unit</th>{cols.map((z) => <th key={z}>{z}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.rateType}</strong></td>
                  <td>{COURIER_SLAB_KG[String(r.rateType).toUpperCase()] ? `${Math.round(num(r.weight) * 1000)}g` : r.rateType === 'PLUSKG' || r.rateType === 'PLUS' ? `${num(r.weight)}kg step` : `${num(r.weight)}kg`}</td>
                  {cols.map((z) => <td key={z}>{r.rates[z] != null ? money(r.rates[z]) : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted" style={{ fontSize: 12 }}>No slabs defined.</p>}
    </div>
  );
}

/** Upload a filled rate matrix → create a card. Pick target (network + product), drop the file. */
function RateUpload({ client, products, vendors, onCancel, onSaved }: {
  client: Client; products: any[]; vendors: any[]; onCancel: () => void; onSaved: () => void;
}) {
  const family = (code: string) => (['DP', 'TDD', 'NDD'].includes(String(code).toUpperCase()) ? 'COURIER' : 'CARGO');
  const productMode = (code: string) => {
    const g = String(products.find((x) => x.code === code)?.attrs?.groupType || '').toUpperCase();
    return g.includes('AIR') ? 'AIR' : g.includes('SURFACE') ? 'SURFACE' : '';
  };
  const [network, setNetwork] = useState('SELF');
  const [product, setProduct] = useState(products[0]?.code ?? '');
  const [fuelPct, setFuelPct] = useState('');
  const [fovPct, setFovPct] = useState('');
  const [fovMin, setFovMin] = useState('');
  const [minChargeableKg, setMinChargeableKg] = useState('');
  const [minFreight, setMinFreight] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  const fam = family(product);
  const onFile = async (f?: File) => {
    if (!f) return;
    setErr(''); setResult(null); setFileName(f.name);
    try {
      const { parseRateWorkbook } = await import('../lib/rateSheet');
      setResult(await parseRateWorkbook(f, fam as any));
    } catch (e: any) { setErr('Parse failed: ' + e.message); }
  };
  const create = async () => {
    setErr('');
    if (!product) { setErr('Pick a product.'); return; }
    const slabs = result?.slabs ?? [];
    if (!slabs.length) { setErr(`No rates parsed — upload a filled ${fam.toLowerCase()} matrix.`); return; }
    setBusy(true);
    try {
      await api.createCustomerCard({
        clientId: client.id, network, vendor: network === 'SELF' ? null : network, product, mode: productMode(product),
        fuelPct: fuelPct || 0, fovPct: fovPct || 0, fovMin: fovMin || 0, minChargeableKg: minChargeableKg || 0, minFreight: minFreight || 0,
        slabs,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <h3 style={{ marginTop: 4 }}>⬆ Upload rate matrix</h3>
      {err && <div className="error">{err}</div>}
      <div className="grid cols-3" style={{ gap: 12 }}>
        <div>
          <label style={{ fontSize: 12 }}>Network</label>
          <select value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="SELF">SELF</option>
            {vendors.map((v) => <option key={v.id} value={(v.vendorCode || v.name).toUpperCase()}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12 }}>Product *</label>
          <select value={product} onChange={(e) => { setProduct(e.target.value); setResult(null); }}>
            {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div><label style={{ fontSize: 12 }}>Family</label><input value={fam} disabled /></div>
        <div><label style={{ fontSize: 12 }}>Fuel %</label><input type="number" value={fuelPct} onChange={(e) => setFuelPct(e.target.value)} /></div>
        <div><label style={{ fontSize: 12 }}>FOV %</label><input type="number" value={fovPct} onChange={(e) => setFovPct(e.target.value)} /></div>
        <div><label style={{ fontSize: 12 }}>FOV min ₹</label><input type="number" value={fovMin} onChange={(e) => setFovMin(e.target.value)} /></div>
        <div><label style={{ fontSize: 12 }}>Min chargeable kg</label><input type="number" step="0.001" value={minChargeableKg} onChange={(e) => setMinChargeableKg(e.target.value)} /></div>
        <div><label style={{ fontSize: 12 }}>Min freight ₹</label><input type="number" value={minFreight} onChange={(e) => setMinFreight(e.target.value)} /></div>
      </div>

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 12 }}>Rate matrix file (.xlsx / .xlsb) — {fam} layout</label>
          <button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }}
            onClick={async () => { const m = await import('../lib/rateSheet'); fam === 'COURIER' ? m.downloadCourierTemplate() : m.downloadCargoTemplate(); }}>
            ⬇ Blank {fam.toLowerCase()} template
          </button>
        </div>
        <input type="file" accept=".xlsx,.xlsb,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {result && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div><b>{fileName}</b> — family <b>{result.family}</b></div>
            <div>Origins: {result.origins.length || '—'} · Dests: {result.dests.length || '—'} · <b>{result.slabs.length}</b> rate cells parsed</div>
            {result.notes.map((n, i) => <div key={i} className="muted" style={{ marginTop: 4 }}>⚠ {n}</div>)}
            {result.slabs.length > 0 && (
              <div className="muted" style={{ marginTop: 4 }}>e.g. {result.slabs.slice(0, 3).map((s) => `${s.originZone}→${s.zone} ₹${s.rate}/kg`).join(' · ')}…</div>
            )}
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          {fam === 'COURIER'
            ? 'Courier: origin blocks (A/B/C/OTHER) × FIRST 250 / FIRST 500 / EVERY ADD 500 GM × dest zones.'
            : 'Cargo: one ₹/kg rate per origin×dest zone cell (18-zone matrix).'}
        </p>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create card from upload'}</button>
      </div>
    </div>
  );
}

/** Create / edit a rate card (header + zone×slab grid). */
function RateCardEditor({ client, card, products, zones, vendors, mechs, chargeMaster, onCancel, onSaved }: {
  client: Client; card: any | null; products: any[]; zones: string[]; vendors: any[]; mechs: any[]; chargeMaster: any[]; onCancel: () => void; onSaved: () => void;
}) {
  // Accessorial charges are master-driven. Codes handled elsewhere are excluded here.
  const EXCLUDE = new Set(['FSC', 'FUEL', 'FREIGHT']);
  const chargeDefs = chargeMaster.filter((c) => !EXCLUDE.has(String(c.code).toUpperCase()));
  const LEGACY: Record<string, any> = {
    FOV: { value: card?.fovPct, min: card?.fovMin }, ODA: { value: card?.odaFlat, perKg: card?.odaPerKg, min: card?.odaMin },
    TOPAY: { value: card?.topayCharge }, APPT: { value: card?.apptCharge }, LOADING: { value: card?.loadingCharge },
    UNLOADING: { value: card?.unloadingCharge }, DOCKET: { value: card?.docketCharge }, AWB: { value: card?.awbCharge },
    EMERGENCY: { value: card?.emergencyCharge }, ENVIRONMENT: { value: card?.environmentCharge }, OSP: { value: card?.ospCharge },
  };
  const [chg, setChg] = useState<Record<string, any>>(() => {
    const seed: Record<string, any> = {};
    for (const c of chargeMaster) { const k = String(c.code).toUpperCase(); if (LEGACY[k]) seed[c.code] = LEGACY[k]; }
    return { ...seed, ...(card?.charges || {}) };
  });
  const setCharge = (code: string, field: string, v: string) => setChg((p) => ({ ...p, [code]: { ...(p[code] || {}), [field]: v } }));
  const baseOf = (c: any) => String(c.attrs?.baseOn || 'FLAT').toUpperCase();
  const productMode = (code: string) => {
    const p = products.find((x) => x.code === code); const g = String(p?.attrs?.groupType || '').toUpperCase();
    return g.includes('AIR') ? 'AIR' : g.includes('SURFACE') ? 'SURFACE' : g.includes('EXPRESS') ? 'EXPRESS' : '';
  };
  const [h, setH] = useState<any>(() => ({
    network: card?.network ?? 'SELF', vendor: card?.vendor ?? '', product: card?.product ?? (products[0]?.code ?? ''),
    mode: card?.mode ?? '', service: card?.service ?? '', label: card?.label ?? '',
    volumetricDivisor: card?.volumetricDivisor ?? 5000, cft: card?.cft ?? 0, minChargeableKg: card?.minChargeableKg ?? 0,
    minFreight: card?.minFreight ?? 0, addlWeightUnitG: card?.addlWeightUnitG ?? 1000,
    fuelMode: card?.fuelMode ?? 'FLAT', fuelPct: card?.fuelPct ?? '', fuelMechanism: card?.fuelMechanism ?? '',
    fovPct: card?.fovPct ?? 0, fovMin: card?.fovMin ?? 0, odaFlat: card?.odaFlat ?? 0, odaPerKg: card?.odaPerKg ?? 0, odaMin: card?.odaMin ?? 0,
    topayCharge: card?.topayCharge ?? 0, apptCharge: card?.apptCharge ?? 0, loadingCharge: card?.loadingCharge ?? 0,
    unloadingCharge: card?.unloadingCharge ?? 0, docketCharge: card?.docketCharge ?? 0,
    validFrom: card?.validFrom ? String(card.validFrom).slice(0, 10) : '', validTo: card?.validTo ? String(card.validTo).slice(0, 10) : '',
    isActive: card?.isActive !== false,
  }));
  // Courier (DP/TDD/NDD) vs cargo drives the slab structure: gram bands × A/B/C/OTHER, or ₹/kg × wide zone matrix.
  const fam: 'COURIER' | 'CARGO' = isCourierProduct(h.product) ? 'COURIER' : 'CARGO';
  const zoneCols = fam === 'COURIER' ? COURIER_ZONES : zones;
  const slabTypes = fam === 'COURIER' ? COURIER_SLAB_TYPES : SLAB_TYPES;
  const courierDefaultRows = () => [
    { rateType: 'FIRST500', weight: '0.5', rates: {} },
    { rateType: 'ADD500', weight: '0.5', rates: {} },
  ];
  const cargoDefaultRows = () => [
    { rateType: 'INITIAL', weight: '0.5', rates: {} },
    { rateType: 'PLUSKG', weight: '1', rates: {} },
  ];

  const set = (k: string, v: any) => setH((p: any) => ({ ...p, [k]: v }));
  const onProduct = (code: string) => {
    setH((p: any) => ({ ...p, product: code, mode: productMode(code) || p.mode }));
    // A brand-new card follows the product's family; reset the (still-default) grid so DP gets
    // gram slabs + A/B/C/OTHER and cargo gets ₹/kg. Editing an existing card keeps its slabs.
    if (!card) setRows(isCourierProduct(code) ? courierDefaultRows() : cargoDefaultRows());
  };

  // slab rows: {rateType, weight, rates:{zone:val}}
  const initRows = () => {
    if (card?.slabs?.length) {
      const m = new Map<string, any>();
      card.slabs.forEach((s: any) => { const k = `${s.rateType}|${s.weight}`; if (!m.has(k)) m.set(k, { rateType: s.rateType, weight: String(s.weight), rates: {} }); m.get(k).rates[s.zone] = String(s.rate); });
      return [...m.values()];
    }
    return isCourierProduct(h.product) ? courierDefaultRows() : cargoDefaultRows();
  };
  const [rows, setRows] = useState<any[]>(initRows);
  const setCell = (i: number, z: string, v: string) => setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, rates: { ...r.rates, [z]: v } } : r));
  const setRow = (i: number, k: string, v: string) => setRows((rs) => rs.map((r, idx) => {
    if (idx !== i) return r;
    // A courier slab type has a fixed weight band (250g/500g) — snap it so the engine matches.
    if (k === 'rateType' && COURIER_SLAB_KG[v]) return { ...r, rateType: v, weight: COURIER_SLAB_KG[v] };
    return { ...r, [k]: v };
  }));
  const addRow = () => setRows((rs) => [...rs, fam === 'COURIER' ? { rateType: 'ADD500', weight: '0.5', rates: {} } : { rateType: 'PLUSKG', weight: '1', rates: {} }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    if (!h.product) { setErr('Pick a product.'); return; }
    const slabs: any[] = [];
    for (const r of rows) for (const z of zoneCols) { const v = r.rates[z]; if (v !== undefined && v !== '' && Number(v) > 0) slabs.push({ zone: z, rateType: r.rateType, weight: Number(r.weight || 0), rate: Number(v) }); }
    const body = { clientId: client.id, ...h, vendor: h.network === 'SELF' ? null : (h.vendor || h.network), slabs, charges: chg };
    setBusy(true);
    try {
      if (card) await api.updateCustomerCard(card.id, body); else await api.createCustomerCard(body);
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const NumF = ({ label, k, step, max }: { label: string; k: string; step?: string; max?: number }) => (
    <div><label style={{ fontSize: 12 }}>{label}</label>
      <input type="number" step={step} max={max} value={h[k]}
        onChange={(e) => { const v = e.target.value; set(k, max != null && v !== '' && Number(v) > max ? String(max) : v); }} />
    </div>
  );

  return (
    <div>
      <h3 style={{ marginTop: 4 }}>{card ? 'Edit' : 'New'} Rate Card</h3>
      {err && <div className="error">{err}</div>}

      {/* header */}
      <div className="grid cols-4" style={{ gap: 12 }}>
        <div>
          <label style={{ fontSize: 12 }}>Network</label>
          <select value={h.network} onChange={(e) => set('network', e.target.value)}>
            <option value="SELF">SELF</option>
            {vendors.map((v) => <option key={v.id} value={(v.vendorCode || v.name).toUpperCase()}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12 }}>Product *</label>
          <select value={h.product} onChange={(e) => onProduct(e.target.value)}>
            <option value="">Select</option>
            {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div><label style={{ fontSize: 12 }}>Mode</label><input value={h.mode} onChange={(e) => set('mode', e.target.value)} placeholder="AIR/SURFACE" /></div>
        <div><label style={{ fontSize: 12 }}>Service</label><input value={h.service} onChange={(e) => set('service', e.target.value)} placeholder="NDD/SDD (opt)" /></div>

        <NumF label="Volumetric ÷ (your choice · cm³/CFT surface · max 27000)" k="volumetricDivisor" max={27000} />
        <NumF label="CFT factor (kg/CFT · surface)" k="cft" step="0.01" />
        <NumF label="Min chargeable (kg)" k="minChargeableKg" step="0.001" />
        <NumF label="Min freight (₹)" k="minFreight" />
      </div>

      {/* FSC */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={{ fontSize: 12 }}>FSC mode</label>
            <select value={h.fuelMode} onChange={(e) => set('fuelMode', e.target.value)}><option>FLAT</option><option>DYNAMIC</option></select>
          </div>
          {h.fuelMode === 'FLAT'
            ? <div><label style={{ fontSize: 12 }}>Fuel % <span className="muted">(flat — Air/Express/DP · blank → inherit master default)</span></label><input type="number" value={h.fuelPct} onChange={(e) => set('fuelPct', e.target.value)} placeholder="inherit" style={{ width: 120 }} /></div>
            : <div><label style={{ fontSize: 12 }}>Diesel surcharge mechanism <span className="muted">(Surface · blank → default)</span></label>
                <select value={h.fuelMechanism} onChange={(e) => set('fuelMechanism', e.target.value)}>
                  <option value="">Inherit default diesel mechanism</option>
                  {mechs.map((m) => <option key={m.code} value={m.code}>{m.code} — {m.name}</option>)}
                </select>
              </div>}
          <span className="muted" style={{ fontSize: 11 }}>FLAT = fixed fuel % (Air/Express/DP) · DYNAMIC = diesel-indexed surcharge (Surface). Set per card.</span>
        </div>
      </div>

      {/* accessorials — driven by the CHARGE master */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Accessorial Charges</strong>
          <span className="muted" style={{ fontSize: 11 }}>from the Charges master — add a charge type there and it appears here.</span>
        </div>
        {!chargeDefs.length ? <p className="muted" style={{ fontSize: 12 }}>No charge types in the master yet. Add them in Masters → Charges.</p> : (
          <div className="grid cols-4" style={{ gap: 12, marginTop: 8 }}>
            {chargeDefs.map((c) => {
              const code = String(c.code).toUpperCase();
              // Fixed rules override the master baseOn: Emergency = % of freight, Appointment = ₹/kg + min.
              const isEmergency = code === 'EMERGENCY', isAppt = code === 'APPT', isOda = code === 'ODA';
              const base = baseOf(c); const pct = isEmergency || base === 'FREIGHT' || base.includes('VALUE');
              const unit = isEmergency ? '% of freight' : isAppt ? '₹/kg' : pct ? '%' : base.includes('WEIGHT') ? '₹/kg' : '₹';
              const showMin = isOda || isAppt || base.includes('VALUE');
              return (
                <div key={c.code}>
                  <label style={{ fontSize: 12 }}>{c.name} <span className="muted">({unit})</span></label>
                  <input type="number" step="0.001" value={chg[c.code]?.value ?? ''} onChange={(e) => setCharge(c.code, 'value', e.target.value)} placeholder={isAppt ? '₹/kg' : '0'} />
                  {showMin && (
                    <input type="number" style={{ marginTop: 4 }} value={chg[c.code]?.min ?? ''} onChange={(e) => setCharge(c.code, 'min', e.target.value)} placeholder="min ₹ (opt)" />
                  )}
                  {isOda && (
                    <input type="number" style={{ marginTop: 4 }} value={chg[c.code]?.perKg ?? ''} onChange={(e) => setCharge(c.code, 'perKg', e.target.value)} placeholder="₹/kg (opt)" />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>ODA / EDL apply to <strong>cargo only</strong> (never DP/courier) — EDL matrix wins on EDL pincodes, else the flat/kg/min here. Emergency = % of freight; Appointment = ₹/kg (chargeable) or its min. FSC is set above.</p>
      </div>

      <div className="grid cols-4" style={{ gap: 12, marginTop: 12 }}>
        <div><label style={{ fontSize: 12 }}>Valid from</label><input type="date" value={h.validFrom} onChange={(e) => set('validFrom', e.target.value)} /></div>
        <div><label style={{ fontSize: 12 }}>Valid to</label><input type="date" value={h.validTo} onChange={(e) => set('validTo', e.target.value)} /></div>
      </div>

      {/* zone × slab grid — DP/courier: gram bands × A/B/C/OTHER · cargo: ₹/kg × zone matrix */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{fam === 'COURIER' ? 'DP / Courier Slab Rates (₹) — gram bands × zones' : 'Zone × Weight Slab Rates (₹)'}</strong>
          <button className="secondary" onClick={addRow} style={{ padding: '3px 10px', fontSize: 12 }}>＋ Slab</button>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>Slab type</th><th>{fam === 'COURIER' ? 'Band' : 'Weight/unit (kg)'}</th>{zoneCols.map((z) => <th key={z}>{z}</th>)}<th></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select value={r.rateType} onChange={(e) => setRow(i, 'rateType', e.target.value)}>
                      {(slabTypes.includes(r.rateType) ? slabTypes : [...slabTypes, r.rateType]).map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    {fam === 'COURIER'
                      ? <span className="muted" style={{ fontSize: 12 }}>{Math.round(num(r.weight) * 1000)} g</span>
                      : <input type="number" step="0.001" value={r.weight} onChange={(e) => setRow(i, 'weight', e.target.value)} style={{ width: 80 }} />}
                  </td>
                  {zoneCols.map((z) => <td key={z}><input type="number" value={r.rates[z] ?? ''} onChange={(e) => setCell(i, z, e.target.value)} style={{ width: 70 }} placeholder="—" /></td>)}
                  <td>{rows.length > 1 && <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => delRow(i)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {fam === 'COURIER'
            ? 'FIRST250 = flat up to 250g · FIRST500 = flat up to 500g · ADD500 = per additional 500g. Zones A/B/C/OTHER come from each pincode’s DP zone.'
            : 'INITIAL = base up to its weight · PLUSKG = ₹/kg beyond · UPTO = tiered flat table · PLUS/ADDITIONAL = per block.'}
        </p>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : (card ? 'Save changes' : 'Create rate card')}</button>
      </div>
    </div>
  );
}
