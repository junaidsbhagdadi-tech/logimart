import { useEffect, useState } from 'react';
import { api, Client } from '../api';

// Customer-code-wise bulk rate upload — one file, many customers × products (Apex + Surface together).
// Columns: CUSTOMER · VENDOR · PRODUCT · Origin\Dest · <18 dest zones>. Each block → one rate card.
const modeOf = (product: string) => {
  const p = product.toUpperCase();
  return p === 'APEX' ? 'AIR' : ['SFC', 'SURFACE', 'HUB'].includes(p) ? 'SURFACE' : ['DP', 'TDD', 'NDD'].includes(p) ? 'SURFACE' : '';
};

type Result = { customer: string; product: string; vendor: string; slabs: number; ok: boolean; error?: string };

export function BulkRateUpload() {
  const [clients, setClients] = useState<Client[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [products, setProducts] = useState<string[]>(['APEX', 'SURFACE']);
  const [validFrom, setValidFrom] = useState(''); // #26 — rates applicable-from date for this upload
  useEffect(() => { api.listClients().then(setClients).catch((e) => setError(e.message)); }, []);
  // Domestic products only (exclude international) — one template block per product.
  useEffect(() => {
    api.listMaster('PRODUCT').then((rows) => {
      const dom = rows
        .filter((r) => !/INTERNATIONAL/i.test(r.name) && !/international/i.test(String(r.attrs?.productType ?? '')) && String(r.attrs?.groupType ?? '').toLowerCase() !== 'international')
        .map((r) => r.code.toUpperCase());
      if (dom.length) setProducts(Array.from(new Set(dom)));
    }).catch(() => {});
  }, []);

  const upload = async (f?: File) => {
    if (!f) return; setError(''); setMsg(''); setResults([]); setBusy(true);
    try {
      const { parseBulkCargoRates } = await import('../lib/rateSheet');
      const blocks = await parseBulkCargoRates(f);
      if (!blocks.length) { setError('No rate blocks found. Use the CUSTOMER · VENDOR · PRODUCT · Origin\\Dest · zones layout.'); setBusy(false); return; }
      const byCode = new Map(clients.map((c) => [String(c.accountCode).toUpperCase(), c]));
      const res: Result[] = [];
      for (const b of blocks) {
        const client = byCode.get(b.customerCode.toUpperCase());
        if (!client) { res.push({ customer: b.customerCode, product: b.product, vendor: b.vendor, slabs: b.slabs.length, ok: false, error: 'customer code not found' }); continue; }
        try {
          await api.createCustomerCard({
            clientId: client.id, network: b.vendor || 'SELF', vendor: b.vendor || null,
            product: b.product, mode: modeOf(b.product), slabs: b.slabs,
            ...(validFrom ? { validFrom } : {}),
          });
          res.push({ customer: `${b.customerCode} — ${client.legalName}`, product: b.product, vendor: b.vendor, slabs: b.slabs.length, ok: true });
        } catch (e: any) { res.push({ customer: b.customerCode, product: b.product, vendor: b.vendor, slabs: b.slabs.length, ok: false, error: e.message }); }
      }
      setResults(res);
      setMsg(`✓ Created ${res.filter((r) => r.ok).length} / ${res.length} rate cards`);
    } catch (e: any) { setError('Parse failed: ' + e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h1>⬆ Bulk Rate Upload <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>— customer-code-wise</span></h1>
      <p className="muted" style={{ marginTop: -14 }}>One workbook, many customers and products — <strong>all domestic products in the same file</strong> (international excluded). Columns: <code>Customer Code · Vendor · Product · Origin\Dest · N1…NE3</code>. Each (customer, vendor, product) block becomes a rate card. The template pre-lays a block per domestic product — just replace <code>CUST001</code> with the real customer code and fill the ₹/kg cells (leave a product's block blank to skip it). Customer codes must match existing customers.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <strong>Upload rate workbook</strong>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>Applicable from <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} title="These rates take effect from this date (blank = today)" /></label>
        <input type="file" accept=".xlsx,.xls,.xlsb,.csv" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        {busy && <span className="muted">Processing…</span>}
        <button className="secondary" style={{ marginLeft: 'auto' }} onClick={async () => { (await import('../lib/rateSheet')).downloadCargoTemplate([], products); }}>⬇ Cargo matrix template ({products.length} products)</button>
      </div>

      <BulkRateAdjust clients={clients} products={products} />

      {results.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Results ({results.filter((r) => r.ok).length}/{results.length})</h2>
          <table>
            <thead><tr><th>Customer</th><th>Product</th><th>Vendor</th><th>Rates</th><th>Status</th></tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.customer}</td><td><strong>{r.product}</strong></td><td>{r.vendor || 'SELF'}</td><td>{r.slabs}</td>
                  <td>{r.ok ? <span className="badge DELIVERED">Created</span> : <span className="badge CANCELLED" title={r.error}>Failed — {r.error}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// #1 — one-shot bulk rate increase/decrease by % or flat ₹, filterable by customer, vendor & product.
function BulkRateAdjust({ clients, products }: { clients: Client[]; products: string[] }) {
  const [dir, setDir] = useState<'INCREASE' | 'DECREASE'>('INCREASE');
  const [mode, setMode] = useState<'PCT' | 'AMOUNT'>('PCT');
  const [value, setValue] = useState('');
  const [clientId, setClientId] = useState(''); // '' = all customers
  const [network, setNetwork] = useState('');   // '' = all vendors/networks
  const [product, setProduct] = useState('');   // '' = all products
  const [round, setRound] = useState(true);
  const [vendors, setVendors] = useState<{ vendorCode: string; name: string }[]>([]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.increaseRateCards>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { api.listVendors().then((v: any[]) => setVendors(v.map((x) => ({ vendorCode: x.vendorCode, name: x.name })))).catch(() => {}); }, []);

  const body = () => ({
    scope: (clientId ? 'SELECT' : 'ALL') as 'ALL' | 'SELECT',
    clientIds: clientId ? [clientId] : undefined,
    mode, value: (dir === 'DECREASE' ? -1 : 1) * Number(value),
    network: network || undefined, product: product || undefined, round,
  });

  const run = async (dryRun: boolean) => {
    setErr(''); setMsg('');
    if (!(Number(value) > 0)) { setErr('Enter a value greater than zero.'); return; }
    setBusy(true);
    try {
      const r = await api.increaseRateCards({ ...body(), dryRun });
      if (dryRun) { setPreview(r); }
      else { setMsg(`✓ Done — ${r.cardsAdjusted} card(s), ${r.slabsAffected ?? 0} rate(s) ${dir === 'INCREASE' ? 'increased' : 'decreased'}.`); setPreview(null); }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const apply = async () => {
    const p = preview;
    if (!p) return;
    if (!confirm(`Apply this ${dir === 'INCREASE' ? 'increase' : 'decrease'} to ${p.cardsAdjusted} card(s) / ${p.slabsAffected ?? 0} rate(s)? This overwrites the stored rates.`)) return;
    run(false);
  };

  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>📊 Bulk rate change</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Increase or decrease freight rates in one shot — by <strong>percentage</strong> or a flat <strong>₹ amount</strong>. Narrow to one customer, one vendor/network and/or one product, or leave the filters on <em>All</em>. Always <strong>Preview</strong> first.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)', margin: '6px 0' }}>{msg}</div>}
      <div className="grid cols-4" style={{ gap: 12 }}>
        <div><label>Direction</label>
          <select value={dir} onChange={(e) => { setDir(e.target.value as any); setPreview(null); }}>
            <option value="INCREASE">Increase ▲</option>
            <option value="DECREASE">Decrease ▼</option>
          </select>
        </div>
        <div><label>By</label>
          <select value={mode} onChange={(e) => { setMode(e.target.value as any); setPreview(null); }}>
            <option value="PCT">Percentage %</option>
            <option value="AMOUNT">Flat amount ₹/kg</option>
          </select>
        </div>
        <div><label>{mode === 'PCT' ? 'Percent %' : 'Amount ₹/kg'} *</label><input type="number" value={value} onChange={(e) => { setValue(e.target.value); setPreview(null); }} placeholder={mode === 'PCT' ? 'e.g. 10' : 'e.g. 2'} /></div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}><label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={round} onChange={(e) => { setRound(e.target.checked); setPreview(null); }} style={{ width: 'auto' }} /> Round to whole ₹</label></div>
      </div>
      <div className="grid cols-3" style={{ gap: 12, marginTop: 10 }}>
        <div><label>Customer</label>
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); setPreview(null); }}>
            <option value="">— All customers —</option>
            {clients.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.accountCode} — {c.legalName}</option>)}
          </select>
        </div>
        <div><label>Vendor / network</label>
          <select value={network} onChange={(e) => { setNetwork(e.target.value); setPreview(null); }}>
            <option value="">— All vendors —</option>
            <option value="SELF">SELF</option>
            {vendors.map((v) => <option key={v.vendorCode} value={v.vendorCode}>{v.vendorCode} — {v.name}</option>)}
          </select>
        </div>
        <div><label>Product</label>
          <select value={product} onChange={(e) => { setProduct(e.target.value); setPreview(null); }}>
            <option value="">— All products —</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <button className="secondary" disabled={busy || !(Number(value) > 0)} onClick={() => run(true)}>{busy ? 'Working…' : '🔍 Preview'}</button>
        {preview && preview.cardsAdjusted > 0 && <button disabled={busy} onClick={apply}>✅ Apply to {preview.cardsAdjusted} card(s)</button>}
      </div>
      {preview && (
        <div style={{ marginTop: 12 }}>
          {preview.cardsAdjusted === 0 ? (
            <p className="muted">No rate cards match those filters.</p>
          ) : (
            <>
              <p style={{ fontSize: 13, margin: '0 0 6px' }}><strong>{preview.cardsAdjusted}</strong> card(s), <strong>{preview.slabsAffected}</strong> rate(s) will change. Sample:</p>
              <table>
                <thead><tr><th>Zone</th><th>Type</th><th>Before</th><th>After</th></tr></thead>
                <tbody>
                  {(preview.preview || []).map((s, i) => (
                    <tr key={i}><td>{s.zone}</td><td className="muted">{s.rateType}</td><td>₹{s.before}</td><td><strong>₹{s.after}</strong></td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
