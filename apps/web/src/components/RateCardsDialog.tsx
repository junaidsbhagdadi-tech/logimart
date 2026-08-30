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
export function RateCardsDialog({ client, vendor, onClose }: { client?: Client; vendor?: any; onClose: () => void }) {
  // A rate card set is owned by a customer (sell-side) OR a vendor (cost-side). Same UI either way.
  const owner = vendor
    ? { kind: 'vendor' as const, id: String(vendor.id), name: vendor.name || vendor.vendorCode || 'Vendor' }
    : { kind: 'client' as const, id: String(client!.id), name: client!.legalName };
  const [cards, setCards] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [mechs, setMechs] = useState<any[]>([]);
  const [chargeMaster, setChargeMaster] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null); // card object, or { _new: true }
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  // Copy-from + rate-increase (customer cards only)
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copy, setCopy] = useState({ src: '', pct: '', round: false });
  const [busy2, setBusy2] = useState(false);

  const load = () => api.listCustomerCards(owner.kind === 'client' ? owner.id : undefined, owner.kind === 'vendor' ? owner.id : undefined).then(setCards).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.listMaster('PRODUCT').then(setProducts).catch(() => {});
    api.listMaster('ZONE').then((z) => setZones(z.map((x) => x.code))).catch(() => {});
    api.listVendors().then((v) => setVendors(v.filter((x) => x.isActive !== false))).catch(() => {});
    api.listMaster('FUEL_MECHANISM').then(setMechs).catch(() => {});
    api.listMaster('CHARGE').then(setChargeMaster).catch(() => {});
    if (owner.kind === 'client') api.listClients().then(setClientsList).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.id, owner.kind]);

  // #copy: pull another customer's cards into this one (freight + accessorials), optional % increase.
  const doCopy = async () => {
    if (!copy.src) { setErr('Pick a source customer.'); return; }
    setBusy2(true); setErr('');
    try {
      const r = await api.copyRateCards({ sourceClientId: copy.src, targetClientId: owner.id, increasePct: Number(copy.pct) || 0, round: copy.round });
      setCopyOpen(false); setCopy({ src: '', pct: '', round: false }); load();
      alert(`Copied ${r.copied} card(s)${Number(copy.pct) ? ` with +${copy.pct}%` : ''}.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy2(false); }
  };
  // #increase: change THIS owner's freight rates — by % (e.g. 5% / -3%) or flat ₹ (e.g. 50 / -20).
  const doIncrease = async () => {
    const raw = window.prompt(`Change ALL of ${owner.name}'s freight rates by how much?\n\n• Percent — add a % sign:  5%  or  -3%\n• Flat ₹ per-kg — a plain number:  50  or  -20`);
    if (raw == null || raw.trim() === '') return;
    const t = raw.trim();
    const mode: 'PCT' | 'AMOUNT' = t.endsWith('%') ? 'PCT' : 'AMOUNT';
    const value = Number(t.replace('%', '').trim());
    if (!Number.isFinite(value) || value === 0) { setErr('Enter a non-zero number (optionally with %).'); return; }
    const round = confirm('Round the new rates to the nearest whole rupee?');
    setBusy2(true); setErr('');
    try {
      const body = owner.kind === 'vendor'
        ? { scope: 'VENDOR' as const, vendorId: owner.id, mode, value, round }
        : { scope: 'SELECT' as const, clientIds: [owner.id], mode, value, round };
      const r = await api.increaseRateCards(body);
      load();
      alert(`Updated ${r.cardsAdjusted} card(s) by ${mode === 'PCT' ? value + '%' : '₹' + value}.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy2(false); }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this rate card?')) return;
    try { await api.delCustomerCard(id); load(); } catch (e: any) { setErr(e.message); }
  };

  // #10 copy this card's accessorial "other charges" to every same-product card (all vendors + SELF).
  const copyCharges = async (card: any) => {
    if (!confirm(`Copy ${card.product} accessorial charges (FOV/ODA/To-Pay/AWB/handling…) to every other ${card.product} card for this customer (all vendors + SELF)? Freight & fuel stay per-card. They remain editable afterwards.`)) return;
    try {
      const r = await api.copyCardCharges(card.id);
      setErr('');
      load();
      alert(r.copiedTo ? `Copied ${card.product} charges to ${r.copiedTo} card(s): ${r.networks.join(', ')}` : `No other ${card.product} cards to copy to.`);
    } catch (e: any) { setErr(e.message); }
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
          <h2 style={{ margin: 0 }}>💳 Rate Cards — {owner.name}{owner.kind === 'vendor' ? <span className="badge CREATED" style={{ marginLeft: 8, fontSize: 11 }}>VENDOR COST</span> : ''}</h2>
          <button className="secondary" onClick={onClose} style={{ padding: '4px 12px' }}>✕ Close</button>
        </div>
        {err && <div className="error">{err}</div>}

        {editing ? (
          <RateCardEditor
            owner={owner} card={editing._new ? null : editing}
            products={products} zones={zones.length ? zones : ['N', 'E', 'W', 'S', 'NE1']} vendors={vendors} mechs={mechs} chargeMaster={chargeMaster}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        ) : uploading ? (
          <RateUpload owner={owner} products={products} vendors={vendors} onCancel={() => setUploading(false)} onSaved={() => { setUploading(false); load(); }} />
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
              <button className="secondary" onClick={async () => { (await import('../lib/rateSheet')).downloadCourierTemplate(); }}>⬇ DP/Courier template</button>
              <button className="secondary" onClick={async () => { (await import('../lib/rateSheet')).downloadCargoTemplate(); }}>⬇ Cargo template</button>
              <button className="secondary" disabled={!cards.length} title="Export these rate cards to Excel (review layout)" onClick={async () => { (await import('../lib/rateSheet')).exportRateCardsXlsx(owner.name, cards); }}>⬇ Export XLS</button>
              {owner.kind === 'client' && <button className="secondary" disabled={!cards.length} title="Export in the bulk-upload layout — edit the cells and re-upload" onClick={async () => { (await import('../lib/rateSheet')).exportRateCardsAsTemplate(String(client?.accountCode || owner.name), cards); }}>⬇ Export as upload template</button>}
              {owner.kind === 'client' && <button className="secondary" onClick={() => setCopyOpen((o) => !o)} title="Copy another customer's rate cards into this one">📋 Copy from…</button>}
              <button className="secondary" disabled={!cards.length || busy2} onClick={doIncrease} title="Increase or decrease these freight rates by % or a flat ₹ amount">↑↓ Change rates</button>
              <button className="secondary" onClick={() => setUploading(true)}>⬆ Upload rates</button>
              <button onClick={() => setEditing({ _new: true })}>＋ Add Rate Card</button>
            </div>
            {copyOpen && owner.kind === 'client' && (
              <div className="card" style={{ background: 'var(--surface-2, #f1f3f6)', padding: 12, marginBottom: 12 }}>
                <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: 2, minWidth: 220 }}>
                    <label>Copy rates FROM customer</label>
                    <select value={copy.src} onChange={(e) => setCopy((c) => ({ ...c, src: e.target.value }))}>
                      <option value="">— select source customer —</option>
                      {clientsList.filter((c) => String(c.id) !== String(owner.id)).map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
                    </select>
                  </div>
                  <div style={{ width: 130 }}><label>% increase <span className="muted">(opt)</span></label><input type="number" value={copy.pct} onChange={(e) => setCopy((c) => ({ ...c, pct: e.target.value }))} placeholder="0" /></div>
                  <label className="row" style={{ gap: 6, fontSize: 13, fontWeight: 600 }}><input type="checkbox" style={{ width: 'auto' }} checked={copy.round} onChange={(e) => setCopy((c) => ({ ...c, round: e.target.checked }))} /> Round off</label>
                  <button disabled={busy2 || !copy.src} onClick={doCopy}>{busy2 ? 'Copying…' : `Copy into ${owner.name}`}</button>
                  <button className="secondary" onClick={() => setCopyOpen(false)}>Cancel</button>
                </div>
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Copies the source customer's freight slabs <strong>and accessorial charges</strong> into {owner.name} (replaces same network+product cards). % increase applies to freight.</p>
              </div>
            )}
            {!cards.length && <p className="muted">No rate cards yet. Click “Add Rate Card” to create one per network (SELF / vendor) &amp; product.</p>}
            {grouped.map(([network, list]) => (
              <div key={network} style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: .3, color: 'var(--muted)', margin: '4px 0 8px' }}>
                  {network === 'SELF' ? '🏠 SELF NETWORK' : `🚚 ${network}`}
                </div>
                {list.map((c) => <CardView key={c.id} card={c} zones={zones} onEdit={() => setEditing(c)} onDelete={() => del(c.id)} onCopyCharges={() => copyCharges(c)} />)}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Read-only card: charges chip-strip + zone × slab matrix. */
function CardView({ card, zones, onEdit, onDelete, onCopyCharges }: { card: any; zones: string[]; onEdit: () => void; onDelete: () => void; onCopyCharges: () => void }) {
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
  if (Array.isArray(card.cityRates) && card.cityRates.length) chips.push({ k: '🏙 City rates', v: card.cityRates.map((c: any) => `${String(c.city).toUpperCase()} ₹${c.perKg}`).join(', ') });

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
          <button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} title="Copy these accessorial charges to every same-product card (all vendors + SELF)" onClick={onCopyCharges}>📋 Copy charges → vendors</button>
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

type Owner = { kind: 'client' | 'vendor'; id: string; name: string };
const ownerKey = (o: Owner) => (o.kind === 'vendor' ? { ownerVendorId: o.id } : { clientId: o.id });

/** Upload a filled rate matrix → create a card. Pick target (network + product), drop the file. */
function RateUpload({ owner, products, vendors, onCancel, onSaved }: {
  owner: Owner; products: any[]; vendors: any[]; onCancel: () => void; onSaved: () => void;
}) {
  const family = (code: string) => (['DP', 'TDD', 'NDD'].includes(String(code).toUpperCase()) ? 'COURIER' : 'CARGO');
  const productMode = (code: string) => {
    const g = String(products.find((x) => x.code === code)?.attrs?.groupType || '').toUpperCase();
    return g.includes('AIR') ? 'AIR' : g.includes('SURFACE') ? 'SURFACE' : '';
  };
  const [famSel, setFamSel] = useState<'CARGO' | 'COURIER'>('CARGO');
  const [network, setNetwork] = useState('SELF');
  // Courier products (DP/TDD/NDD) picked here; cargo products come from the file's Product column.
  const courierProducts = products.filter((p) => family(p.code) === 'COURIER');
  const cargoProductCodes = products
    .filter((p) => family(p.code) === 'CARGO' && !/INTERNATIONAL/i.test(p.name) && String(p.attrs?.groupType ?? '').toLowerCase() !== 'international')
    .map((p) => p.code.toUpperCase());
  const [product, setProduct] = useState(products[0]?.code ?? '');
  const [fuelPct, setFuelPct] = useState('');
  const [fovPct, setFovPct] = useState('');
  const [fovMin, setFovMin] = useState('');
  const [minChargeableKg, setMinChargeableKg] = useState('');
  const [minFreight, setMinFreight] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [blocks, setBlocks] = useState<{ vendor: string; product: string; slabs: any[] }[]>([]); // cargo: one per (vendor, product)
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  const fam = famSel;
  // Map a sheet vendor label → card network code (SELF, or the vendor's code/name).
  const toNetwork = (vend: string) => {
    const v = String(vend || '').trim().toUpperCase();
    if (!v || v === 'SELF') return 'SELF';
    const m = vendors.find((x) => String(x.vendorCode || '').toUpperCase() === v || String(x.name || '').toUpperCase() === v || (x.name && v.includes(String(x.name).toUpperCase())));
    return String(m?.vendorCode || vend).toUpperCase();
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    setErr(''); setResult(null); setBlocks([]); setFileName(f.name);
    try {
      const m = await import('../lib/rateSheet');
      if (fam === 'CARGO') {
        // Read the Product column: one card per (vendor, product) block, all for this customer.
        const bl = await m.parseBulkCargoRates(f);
        const kept = bl.filter((b) => b.slabs.length).map((b) => ({ vendor: b.vendor || 'SELF', product: (b.product || product).toUpperCase(), slabs: b.slabs }));
        if (!kept.length) { setErr('No rate blocks parsed — fill at least one product block (₹/kg per zone).'); return; }
        setBlocks(kept);
      } else {
        setResult(await m.parseRateWorkbook(f, fam as any));
      }
    } catch (e: any) { setErr('Parse failed: ' + e.message); }
  };
  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      const acc = { ...ownerKey(owner), fuelPct: fuelPct || 0, fovPct: fovPct || 0, fovMin: fovMin || 0, minChargeableKg: minChargeableKg || 0, minFreight: minFreight || 0 };
      if (fam === 'CARGO') {
        if (!blocks.length) { setErr('No rate blocks parsed — upload a filled cargo matrix.'); return; }
        // One card per (vendor, product) block — the product comes from the file's Product column.
        for (const b of blocks) {
          const net = toNetwork(b.vendor);
          await api.createCustomerCard({ ...acc, product: b.product, mode: productMode(b.product) || 'SURFACE', network: net, vendor: net === 'SELF' ? null : net, slabs: b.slabs });
        }
      } else {
        if (!product) { setErr('Pick a product.'); return; }
        const head = { ...acc, product, mode: productMode(product) };
        const slabs = result?.slabs ?? [];
        if (!slabs.length) { setErr(`No rates parsed — upload a filled ${fam.toLowerCase()} matrix.`); return; }
        await api.createCustomerCard({ ...head, network, vendor: network === 'SELF' ? null : network, slabs });
      }
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <h3 style={{ marginTop: 4 }}>⬆ Upload rate matrix</h3>
      {err && <div className="error">{err}</div>}
      <div className="grid cols-3" style={{ gap: 12 }}>
        <div>
          <label style={{ fontSize: 12 }}>Rate family</label>
          <select value={famSel} onChange={(e) => { setFamSel(e.target.value as any); setResult(null); setBlocks([]); }}>
            <option value="CARGO">Cargo — per-kg (all cargo products in one file)</option>
            <option value="COURIER">Courier — DP / TDD / NDD (weight slabs)</option>
          </select>
        </div>
        {fam === 'CARGO' ? (
          <div>
            <label style={{ fontSize: 12 }}>Product &amp; Network</label>
            <input value="From file (Product + Vendor columns)" disabled title="Cargo: the file's Product & Vendor columns drive the cards — one per (vendor × product)." />
          </div>
        ) : (
          <>
            <div>
              <label style={{ fontSize: 12 }}>Network</label>
              <select value={network} onChange={(e) => setNetwork(e.target.value)}>
                <option value="SELF">SELF / All networks</option>
                {vendors.map((v) => <option key={v.id} value={(v.vendorCode || v.name).toUpperCase()}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12 }}>Product *</label>
              <select value={product} onChange={(e) => { setProduct(e.target.value); setResult(null); setBlocks([]); }}>
                {courierProducts.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            </div>
          </>
        )}
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
            onClick={async () => { const m = await import('../lib/rateSheet'); fam === 'COURIER' ? m.downloadCourierTemplate() : m.downloadCargoTemplate(vendors.map((v) => String(v.vendorCode || v.name)), cargoProductCodes); }}>
            ⬇ Blank {fam.toLowerCase()} template{fam === 'CARGO' ? ` (${cargoProductCodes.length} products)` : ''}
          </button>
        </div>
        <input type="file" accept=".xlsx,.xlsb,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {fam === 'CARGO' && blocks.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div><b>{fileName}</b> — <b>{blocks.length}</b> card{blocks.length > 1 ? 's' : ''} to create:</div>
            <table style={{ marginTop: 6 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Product</th><th style={{ textAlign: 'left' }}>Vendor (file)</th><th>→ Network</th><th style={{ textAlign: 'right' }}>Rate cells</th></tr></thead>
              <tbody>{blocks.map((b, i) => (
                <tr key={i}><td><strong>{b.product}</strong></td><td>{b.vendor}</td><td><strong>{toNetwork(b.vendor)}</strong></td><td style={{ textAlign: 'right' }}>{b.slabs.length}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {fam === 'COURIER' && result && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div><b>{fileName}</b> — family <b>{result.family}</b></div>
            <div>Origins: {result.origins.length || '—'} · Dests: {result.dests.length || '—'} · <b>{result.slabs.length}</b> rate cells parsed</div>
            {result.notes.map((n, i) => <div key={i} className="muted" style={{ marginTop: 4 }}>⚠ {n}</div>)}
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          {fam === 'COURIER'
            ? 'Courier: origin blocks (A/B/C/OTHER) × FIRST 250 / FIRST 500 / EVERY ADD 500 GM × dest zones.'
            : 'Cargo: one 18×18 zone matrix per VENDOR (Customer Code · Vendor · Origin\\Dest · zones). Each vendor block → one rate card; the shipment\'s vendor pick applies its rate.'}
        </p>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button onClick={create} disabled={busy}>{busy ? 'Creating…' : (fam === 'CARGO' && blocks.length > 1 ? `Create ${blocks.length} vendor cards` : 'Create card from upload')}</button>
      </div>
    </div>
  );
}

/** Create / edit a rate card (header + zone×slab grid). */
function RateCardEditor({ owner, card, products, zones, vendors, mechs, chargeMaster, onCancel, onSaved }: {
  owner: Owner; card: any | null; products: any[]; zones: string[]; vendors: any[]; mechs: any[]; chargeMaster: any[]; onCancel: () => void; onSaved: () => void;
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
  // OSW override helpers (per-card): threshold + 4 weight slabs stored under chg.OSW.
  const OSW_SLABS = [{ fromKg: 0, toKg: 30 }, { fromKg: 31, toKg: 70 }, { fromKg: 71, toKg: 200 }, { fromKg: 201, toKg: 999999 }];
  const slabLbl = (s: { fromKg: number; toKg: number }) => (s.toKg >= 999999 ? `${s.fromKg} kg+` : `${s.fromKg}–${s.toKg} kg`);
  const setOsw = (k: string, v: string) => setChg((p) => ({ ...p, OSW: { ...(p.OSW || {}), [k]: v } }));
  const setOswSlab = (i: number, v: string) => setChg((p) => {
    const slabs = OSW_SLABS.map((s, idx) => ({ fromKg: s.fromKg, toKg: s.toKg, perKg: idx === i ? v : (p.OSW?.slabs?.[idx]?.perKg ?? '') }));
    return { ...p, OSW: { ...(p.OSW || {}), slabs } };
  });
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
    cityRates: Array.isArray(card?.cityRates) ? card.cityRates.map((c: any) => ({ city: c.city ?? '', perKg: c.perKg ?? '', min: c.min ?? '' })) : [],
  }));
  const cityRates: any[] = Array.isArray(h.cityRates) ? h.cityRates : [];
  // Courier (DP/TDD/NDD) vs cargo drives the slab structure: gram bands × A/B/C/OTHER, or ₹/kg × wide zone matrix.
  const fam: 'COURIER' | 'CARGO' = isCourierProduct(h.product) ? 'COURIER' : 'CARGO';
  // Fuel model by transport mode: AIR/Express/DP → FSC (flat %); SURFACE/TRAIN → DSC (diesel-indexed).
  // CFT applies to surface/train only (not air).
  const groupOf = (code: string) => String(products.find((x) => x.code === code)?.attrs?.groupType || '').toUpperCase();
  const isSurfaceMode = (() => { const g = groupOf(h.product); return g.includes('SURFACE') || g.includes('TRAIN') || g.includes('RAIL'); })();
  const fuelLabel = isSurfaceMode ? 'DSC (Diesel Surcharge)' : 'FSC (Fuel Surcharge)';
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
    const g = groupOf(code);
    const surf = g.includes('SURFACE') || g.includes('TRAIN') || g.includes('RAIL');
    // Auto-pick the fuel model: surface/train → DSC (DYNAMIC diesel), else FSC (FLAT). CFT is
    // surface-only, so clear it for air. Mode auto-fills from the product.
    setH((p: any) => ({ ...p, product: code, mode: productMode(code) || p.mode, fuelMode: surf ? 'DYNAMIC' : 'FLAT', cft: surf ? p.cft : 0 }));
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
    const body = { ...ownerKey(owner), ...h, mode: productMode(h.product) || h.mode, vendor: h.network === 'SELF' ? null : (h.vendor || h.network), slabs, charges: chg };
    setBusy(true);
    try {
      if (card) await api.updateCustomerCard(card.id, body); else await api.createCustomerCard(body);
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  // Inline render fn (NOT a component) — a <NumF/> component defined in-render remounts the
  // input on every keystroke and steals focus. Calling numF(...) inlines the JSX so focus stays.
  const numF = (label: string, k: string, step?: string, max?: number) => (
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
            <option value="SELF">SELF / All networks</option>
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
        <div><label style={{ fontSize: 12 }}>Mode <span className="muted">(from product)</span></label><input value={productMode(h.product) || h.mode || '—'} disabled /></div>
        <div><label style={{ fontSize: 12 }}>Service</label><input value={h.service} onChange={(e) => set('service', e.target.value)} placeholder="NDD/SDD (opt)" /></div>

        {numF('Volumetric ÷ (your choice · cm³/CFT surface · max 27000)', 'volumetricDivisor', undefined, 27000)}
        {isSurfaceMode && numF('CFT factor (kg/CFT · surface)', 'cft', '0.01')}
        {numF('Min chargeable (kg)', 'minChargeableKg', '0.001')}
        {numF('Min freight (₹)', 'minFreight')}
      </div>

      {/* City-specific special rates — override the zone rate for named destination cities */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong style={{ fontSize: 13 }}>🏙 City-specific rates</strong>
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>special ₹/kg for named destination cities — overrides the zone rate when the consignee city matches</span>
          </div>
          <button className="secondary" type="button" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => set('cityRates', [...cityRates, { city: '', perKg: '', min: '' }])}>＋ Add city</button>
        </div>
        {cityRates.length > 0 && (
          <table style={{ marginTop: 8 }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Destination city</th><th style={{ width: 130 }}>Rate ₹/kg</th><th style={{ width: 130 }}>Min ₹ (opt)</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {cityRates.map((c, i) => (
                <tr key={i}>
                  <td><input value={c.city} placeholder="e.g. GURGAON" style={{ textTransform: 'uppercase' }} onChange={(e) => set('cityRates', cityRates.map((x, idx) => idx === i ? { ...x, city: e.target.value } : x))} /></td>
                  <td><input type="number" step="0.01" value={c.perKg} onChange={(e) => set('cityRates', cityRates.map((x, idx) => idx === i ? { ...x, perKg: e.target.value } : x))} /></td>
                  <td><input type="number" step="0.01" value={c.min} onChange={(e) => set('cityRates', cityRates.map((x, idx) => idx === i ? { ...x, min: e.target.value } : x))} /></td>
                  <td><button className="secondary" type="button" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => set('cityRates', cityRates.filter((_, idx) => idx !== i))}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Fuel surcharge — FSC (air) or DSC (surface/train), auto-picked from the product */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div style={{ marginBottom: 8 }}><strong style={{ fontSize: 13 }}>⛽ {fuelLabel}</strong> <span className="muted" style={{ fontSize: 11 }}>auto from product mode ({productMode(h.product) || h.mode || '—'}) — FSC for Air/Express/DP, DSC for Surface/Train</span></div>
        <div className="row" style={{ gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={{ fontSize: 12 }}>{isSurfaceMode ? 'DSC' : 'FSC'} mode <span className="muted">(auto)</span></label>
            <select value={h.fuelMode} onChange={(e) => set('fuelMode', e.target.value)}><option>FLAT</option><option>DYNAMIC</option></select>
          </div>
          {h.fuelMode === 'FLAT'
            ? <div><label style={{ fontSize: 12 }}>FSC % <span className="muted">(flat — Air/Express/DP · blank → inherit master default)</span></label><input type="number" value={h.fuelPct} onChange={(e) => set('fuelPct', e.target.value)} placeholder="inherit" style={{ width: 120 }} /></div>
            : <div><label style={{ fontSize: 12 }}>Diesel surcharge mechanism <span className="muted">(Surface/Train · blank → default)</span></label>
                <select value={h.fuelMechanism} onChange={(e) => set('fuelMechanism', e.target.value)}>
                  <option value="">Inherit default diesel mechanism</option>
                  {mechs.map((m) => <option key={m.code} value={m.code}>{m.code} — {m.name}</option>)}
                </select>
              </div>}
          <span className="muted" style={{ fontSize: 11 }}>FLAT = fixed fuel % (Air/Express/DP) · DYNAMIC = diesel-indexed surcharge (Surface/Train).</span>
        </div>
      </div>

      {/* accessorials — driven by the CHARGE master */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Accessorial Charges</strong>
          <span className="muted" style={{ fontSize: 11 }}>Apex/Surface inherit the default rate from <strong>Masters → Charges</strong> — leave blank to use it; a value here overrides for this card. (DP/courier bills only what's set here.)</span>
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
                  <label style={{ fontSize: 12 }}>{isOda ? `ODA — ${c.name}` : c.name} <span className="muted">({isOda ? 'flat + ₹/kg, min' : unit})</span></label>
                  <input type="number" step="0.001" value={chg[c.code]?.value ?? ''} onChange={(e) => setCharge(c.code, 'value', e.target.value)} placeholder={isOda ? 'flat ₹' : isAppt ? '₹/kg' : '0'} />
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

      {/* RAS / OSW per-card overrides — blank inherits Masters → OSW/RAS */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Surcharge overrides — RAS / OSW</strong>
          <span className="muted" style={{ fontSize: 11 }}>Leave blank to inherit <strong>Masters → OSW / RAS</strong>; a value here overrides for this card only.</span>
        </div>
        <div className="grid cols-4" style={{ gap: 12, marginTop: 8 }}>
          <div><label style={{ fontSize: 12 }}>RAS (₹/kg)</label><input type="number" value={chg.RAS?.value ?? ''} onChange={(e) => setCharge('RAS', 'value', e.target.value)} placeholder="inherit" /></div>
          <div><label style={{ fontSize: 12 }}>OSW dim threshold (cm)</label><input type="number" value={chg.OSW?.thresholdCm ?? ''} onChange={(e) => setOsw('thresholdCm', e.target.value)} placeholder="119" /></div>
          <div><label style={{ fontSize: 12 }}>OSW weight threshold (kg)</label><input type="number" value={chg.OSW?.thresholdKg ?? ''} onChange={(e) => setOsw('thresholdKg', e.target.value)} placeholder="69" /></div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>OSW rate ₹/kg by weight slab <span className="muted">(blank = inherit)</span></label>
          <div className="grid cols-4" style={{ gap: 8, marginTop: 4 }}>
            {OSW_SLABS.map((s, i) => (
              <div key={i}><label style={{ fontSize: 11 }} className="muted">{slabLbl(s)}</label>
                <input type="number" value={chg.OSW?.slabs?.[i]?.perKg ?? ''} onChange={(e) => setOswSlab(i, e.target.value)} placeholder="₹/kg" /></div>
            ))}
          </div>
        </div>
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
