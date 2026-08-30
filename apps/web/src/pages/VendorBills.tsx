import { useEffect, useState } from 'react';
import { api } from '../api';

const money = (v: any) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

/** Vendor bill (cost) upload + AWB-wise profit/loss (our sell − vendor cost). */
export function VendorBills() {
  const [tab, setTab] = useState<'upload' | 'pnl'>('upload');
  return (
    <>
      <h1>🚚 Vendor Bills &amp; P&amp;L</h1>
      <p className="muted" style={{ marginTop: -14 }}>Upload vendor bill files (cost per AWB) and see profit/loss vs your sell rate, AWB-wise.</p>
      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <button className={tab === 'upload' ? '' : 'secondary'} onClick={() => setTab('upload')}>⬆ Upload Vendor Bill</button>
          <button className={tab === 'pnl' ? '' : 'secondary'} onClick={() => setTab('pnl')}>📊 Profit / Loss</button>
        </div>
      </div>
      {tab === 'upload' ? <UploadTab /> : <PnlTab />}
    </>
  );
}

function UploadTab() {
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadRecent = () => { api.listVendorBills().then((r) => setRecent(r.slice(0, 50))).catch(() => {}); };
  useEffect(loadRecent, [result]);

  const onFile = async (f?: File) => {
    if (!f) return; setErr(''); setRows(null); setResult(null); setFileName(f.name);
    try { const { parseVendorBill } = await import('../lib/rateSheet'); setRows(await parseVendorBill(f)); }
    catch (e: any) { setErr('Parse failed: ' + e.message); }
  };
  const upload = async () => {
    if (!rows?.length) return; setBusy(true); setErr(''); setResult(null);
    try {
      let imported = 0, failed = 0;
      for (let i = 0; i < rows.length; i += 500) { const r = await api.bulkVendorBills(rows.slice(i, i + 500)); imported += r.imported; failed += r.failed; }
      setResult({ imported, failed });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card">
        <h2>⬆ Upload vendor bill (.xlsx / .xlsb)</h2>
        <p className="muted" style={{ fontSize: 12 }}>Columns: Vendor Code · Product · AWB · Pickup date · Origin/Dest · weights · Freight · FS · CAF · AWB · Green tax · EDL · FOV · TDD · TOPAY · Total · Total w/GST · pincode · Declared value.</p>
        <input type="file" accept=".xlsx,.xlsb,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {rows && <div style={{ marginTop: 8, fontSize: 13 }}><b>{fileName}</b> — {rows.length} bill rows parsed.
          {rows[0] && <span className="muted"> e.g. {rows[0].vendorCode} · AWB {rows[0].awb} · cost {money(rows[0].totalWithGst)}</span>}</div>}
        {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
        {result && <div className="card" style={{ borderLeft: '4px solid var(--ok)', marginTop: 8 }}>✓ Imported {result.imported} vendor bills{result.failed ? `, ${result.failed} failed` : ''}.</div>}
        <div className="row" style={{ marginTop: 12 }}><button onClick={upload} disabled={busy || !rows?.length}>{busy ? 'Uploading…' : `Upload ${rows?.length || ''} bills`}</button></div>
      </div>

      <div className="card">
        <h2>Recent vendor bills ({recent.length})</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>Vendor</th><th>AWB</th><th>Product</th><th>Lane</th><th>Chrg kg</th><th>Freight</th><th>FS</th><th>EDL</th><th>Total</th><th>Total+GST</th></tr></thead>
            <tbody>
              {recent.map((b) => (
                <tr key={b.id}>
                  <td>{b.vendorCode}</td><td>{b.awb}</td><td>{b.product}</td><td>{b.origin}→{b.destination}</td>
                  <td>{Number(b.chrgWeight ?? 0)}</td><td>{money(b.freight)}</td><td>{money(b.fs)}</td><td>{money(b.edl)}</td>
                  <td>{money(b.total)}</td><td><strong>{money(b.totalWithGst)}</strong></td>
                </tr>
              ))}
              {!recent.length && <tr><td colSpan={10} className="muted">No vendor bills uploaded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PnlTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<{ count: number; totalSell: number; totalCost: number; totalMargin: number; rows: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sign, setSign] = useState<'all' | 'pos' | 'zero' | 'neg'>('all');

  const run = async () => { setErr(''); setBusy(true); try { setData(await api.getPnl(from || undefined, to || undefined)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  // Client-side search (vendor + customer + AWB + lane) and margin-sign filter; totals reflect the filter.
  const rows = (data?.rows ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    const hitQ = !s || [r.vendorAwb, r.ourAwb, r.customer, r.vendorCode, r.product, r.origin, r.destination].some((v) => String(v ?? '').toLowerCase().includes(s));
    const hitSign = sign === 'all' || (sign === 'pos' && r.margin > 0) || (sign === 'zero' && r.margin === 0) || (sign === 'neg' && r.margin < 0);
    return hitQ && hitSign;
  });
  const fT = rows.reduce((a, r) => ({ sell: a.sell + r.sell, cost: a.cost + r.cost, margin: a.margin + r.margin }), { sell: 0, cost: 0, margin: 0 });

  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div><label>From <span className="muted">(opt.)</span></label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To <span className="muted">(opt.)</span></label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button onClick={run} disabled={busy}>{busy ? 'Working…' : 'Refresh'}</button>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 200 }}><label>Search <span className="muted">vendor / customer / AWB</span></label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. BDR, Acme, 5800…" /></div>
          <div className="row" style={{ gap: 6 }}>
            {([['all', 'All'], ['pos', '▲ Positive'], ['zero', '0 Zero'], ['neg', '▼ Negative']] as const).map(([k, lbl]) => (
              <button key={k} className={sign === k ? '' : 'secondary'} style={{ padding: '7px 12px', fontSize: 13 }} onClick={() => setSign(k)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {data && (
        <>
          <div className="grid cols-4" style={{ gap: 12 }}>
            <div className="card"><div className="muted">AWBs{rows.length !== data.count ? ` (of ${data.count})` : ''}</div><div style={{ fontSize: 24, fontWeight: 800 }}>{rows.length}</div></div>
            <div className="card"><div className="muted">Sell</div><div style={{ fontSize: 24, fontWeight: 800 }}>{money(fT.sell)}</div></div>
            <div className="card"><div className="muted">Cost</div><div style={{ fontSize: 24, fontWeight: 800 }}>{money(fT.cost)}</div></div>
            <div className="card" style={{ borderLeft: `4px solid ${fT.margin >= 0 ? 'var(--ok)' : 'var(--warn)'}` }}><div className="muted">Margin</div><div style={{ fontSize: 24, fontWeight: 800, color: fT.margin >= 0 ? 'var(--ok)' : 'var(--warn)' }}>{money(fT.margin)}</div></div>
          </div>
          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 13 }}>
                <thead><tr><th>Vendor AWB</th><th>Our AWB</th><th>Customer</th><th>Product</th><th>Lane</th><th>Sell</th><th>Cost</th><th>Margin</th><th>Match</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.vendorAwb}</td><td>{r.ourAwb ?? '—'}</td><td>{r.customer ?? '—'}</td><td>{r.product}</td><td>{r.origin}→{r.destination}</td>
                      <td>{money(r.sell)}</td><td>{money(r.cost)}</td>
                      <td style={{ color: r.margin >= 0 ? 'var(--ok)' : 'var(--warn)', fontWeight: 700 }}>{money(r.margin)}</td>
                      <td>{r.matched ? <span className="badge DELIVERED">matched</span> : <span className="badge EXCEPTION">unmatched</span>}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={9} className="muted">{data.count ? 'No rows match the search / filter.' : 'No vendor bills yet — upload some first.'}</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Match = our shipment found by carrier waybill (bdWaybill) or AWB. Unmatched bills show cost only (sell needs the AWB link).</p>
          </div>
        </>
      )}
    </>
  );
}
