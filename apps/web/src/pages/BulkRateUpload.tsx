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
