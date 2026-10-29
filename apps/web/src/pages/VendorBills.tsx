import { useEffect, useState } from 'react';
import { api } from '../api';

const money = (v: any) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

/** Vendor bill (cost) upload + AWB-wise profit/loss (our sell − vendor cost). */
export function VendorBills() {
  const [tab, setTab] = useState<'upload' | 'pnl' | 'recon'>('upload');
  return (
    <>
      <h1>🚚 Vendor Bills &amp; P&amp;L</h1>
      <p className="muted" style={{ marginTop: -14 }}>Upload vendor bill files (cost per AWB) and see profit/loss vs your sell rate, AWB-wise.</p>
      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <button className={tab === 'upload' ? '' : 'secondary'} onClick={() => setTab('upload')}>⬆ Upload Vendor Bill</button>
          <button className={tab === 'pnl' ? '' : 'secondary'} onClick={() => setTab('pnl')}>📊 Profit / Loss</button>
          <button className={tab === 'recon' ? '' : 'secondary'} onClick={() => setTab('recon')}>🔍 Check vendor P&amp;L sheet</button>
        </div>
      </div>
      {tab === 'upload' ? <UploadTab /> : tab === 'pnl' ? <PnlTab /> : <ReconTab />}
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
  const [vendor, setVendor] = useState('');

  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  // Background job on the server (was a 504 on even a few days) — progress = vendor bills priced.
  const run = async () => { setErr(''); setBusy(true); setProg(null); try { setData(await api.getPnl(from || undefined, to || undefined, (done, total) => setProg({ done, total }))); } catch (e: any) { setErr(e.message); } finally { setBusy(false); setProg(null); } };
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const vendors = Array.from(new Set((data?.rows ?? []).map((r) => String(r.vendorCode ?? '').trim()).filter(Boolean))).sort();
  // Client-side search (vendor + customer + AWB + lane), vendor filter, and margin-sign filter; totals reflect the filter.
  const rows = (data?.rows ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    const hitQ = !s || [r.vendorAwb, r.forwardingNo, r.ourAwb, r.customer, r.vendorCode, r.product, r.origin, r.destination].some((v) => String(v ?? '').toLowerCase().includes(s));
    const hitSign = sign === 'all' || (sign === 'pos' && r.margin > 0) || (sign === 'zero' && r.margin === 0) || (sign === 'neg' && r.margin < 0);
    const hitVendor = !vendor || String(r.vendorCode ?? '') === vendor;
    return hitQ && hitSign && hitVendor;
  });
  const fT = rows.reduce((a, r) => ({ sell: a.sell + r.sell, cost: a.cost + r.cost, margin: a.margin + r.margin }), { sell: 0, cost: 0, margin: 0 });

  const exportXls = async () => {
    if (!rows.length) return;
    const XLSX = await import('xlsx');
    const head = ['Vendor AWB', 'Forwarding No', 'Our AWB', 'Customer', 'Vendor', 'Product', 'Origin', 'Destination', 'Charge Wt', 'Cost', 'Sell', 'Margin', 'Matched'];
    const body = rows.map((r) => [r.vendorAwb, r.forwardingNo ?? '', r.ourAwb ?? '', r.customer ?? '', r.vendorCode ?? '', r.product ?? '', r.origin ?? '', r.destination ?? '', Number(r.chrgWeight ?? 0), Number(r.cost), Number(r.sell), Number(r.margin), r.matched ? 'Yes' : 'No']);
    body.push(['', '', '', '', '', '', '', '', 'TOTAL', +fT.cost.toFixed(2), +fT.sell.toFixed(2), +fT.margin.toFixed(2), '']);
    const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Vendor P&L');
    XLSX.writeFile(wb, `vendor-pnl-${from || 'all'}_${to || 'all'}.xlsx`);
  };

  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div><label>From <span className="muted">(opt.)</span></label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To <span className="muted">(opt.)</span></label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button onClick={run} disabled={busy}>{busy ? (prog?.total ? `Pricing ${prog.done.toLocaleString()} / ${prog.total.toLocaleString()}…` : 'Working…') : 'Refresh'}</button>
          <button className="secondary" onClick={exportXls} disabled={!rows.length}>⬇ Excel</button>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 200 }}><label>Search <span className="muted">vendor / customer / AWB</span></label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. BDR, Acme, 5800…" /></div>
          <div><label>Vendor</label>
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} style={{ minWidth: 140 }}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
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
                <thead><tr><th>Vendor AWB</th><th>Fwd No.</th><th>Our AWB</th><th>Customer</th><th>Product</th><th>Lane</th><th>Sell</th><th>Cost</th><th>Margin</th><th>Match</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.vendorAwb}</td><td>{r.forwardingNo ?? '—'}</td><td>{r.ourAwb ?? '—'}</td><td>{r.customer ?? '—'}</td><td>{r.product}</td><td>{r.origin}→{r.destination}</td>
                      <td>{money(r.sell)}</td><td>{money(r.cost)}</td>
                      <td style={{ color: r.margin >= 0 ? 'var(--ok)' : 'var(--warn)', fontWeight: 700 }}>{money(r.margin)}</td>
                      <td>{r.matched ? <span className="badge DELIVERED">matched</span> : <span className="badge EXCEPTION">unmatched</span>}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={10} className="muted">{data.count ? 'No rows match the search / filter.' : 'No vendor bills yet — upload some first.'}</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Match = our shipment found by <strong>AWB or forwarding number</strong> (the bill's AWB or Fwd-No matched against our AWB / forwarding AWB / carrier waybill / reference no, case-insensitive). Unmatched bills show cost only (sell needs the AWB link).</p>
          </div>
        </>
      )}
    </>
  );
}

// swdev #8-5 — vendor P&L sheet: Vendor code · AWB No · Forwarding no · Charged Weight · Invoice Value ·
// destination pincode · EDL Charges · Total Sales excluding GST. Matched on forwarding no vs our billing.
const RECON_HEADS: { key: string; match: RegExp }[] = [
  { key: 'vendorCode', match: /^vendor\s*code$|^vendor$/ },
  { key: 'awb', match: /^awb(\s*no)?$/ },
  { key: 'forwardingNo', match: /^forwarding(\s*no)?$|^fwd(\s*awb|\s*no)?$/ },
  { key: 'chargeWeight', match: /^charge(d)?\s*weight$|^chrg\s*w(eigh)?t$/ },
  { key: 'invoiceValue', match: /^invoice\s*value$|^declared\s*value$/ },
  { key: 'destPincode', match: /^dest(ination)?\s*pin(code)?$/ },
  { key: 'edl', match: /^edl(\s*charges?)?$/ },
  { key: 'totalExGst', match: /^total\s*sales?(\s*excl?(uding)?\s*gst)?$|^total$/ },
];

function ReconTab() {
  const [res, setRes] = useState<{ count: number; matched: number; withDifferences: number; rows: any[] } | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fileName, setFileName] = useState('');

  const onFile = async (file?: File) => {
    if (!file) return; setErr(''); setRes(null); setFileName(file.name); setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer());
      const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      const hi = grid.findIndex((r) => r.some((c) => /forwarding/i.test(String(c))));
      if (hi < 0) throw new Error('No "Forwarding no" column header found in the first sheet.');
      const norm = (h: any) => String(h).trim().toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const idx: Record<string, number> = {};
      grid[hi].forEach((h, i) => { const k = RECON_HEADS.find((x) => x.match.test(norm(h)))?.key; if (k && idx[k] == null) idx[k] = i; });
      const rows = grid.slice(hi + 1)
        .map((r) => Object.fromEntries(RECON_HEADS.map((h) => [h.key, idx[h.key] != null ? r[idx[h.key]] : ''])))
        .filter((r) => String(r.forwardingNo).trim() || String(r.awb).trim());
      if (!rows.length) throw new Error('The sheet has no data rows.');
      const all: any[] = []; let matched = 0, withDifferences = 0;
      for (let i = 0; i < rows.length; i += 2000) {
        const r = await api.reconcileVendorSheet(rows.slice(i, i + 2000));
        all.push(...r.rows); matched += r.matched; withDifferences += r.withDifferences;
      }
      setRes({ count: all.length, matched, withDifferences, rows: all });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const shown = res ? (onlyDiff ? res.rows.filter((r) => r.issues.length) : res.rows) : [];
  const num = (v: any) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
  const dcell = (v: any) => (v == null || v === 0 ? <span className="muted">—</span> : <strong style={{ color: v > 0 ? 'var(--bad, #c0392b)' : 'var(--ok, #16a34a)' }}>{v > 0 ? '+' : ''}{Number(v).toLocaleString('en-IN')}</strong>);

  const exportXls = async () => {
    if (!res) return;
    const XLSX = await import('xlsx');
    const head = ['Vendor code', 'AWB No (sheet)', 'Forwarding no', 'Our AWB', 'Customer Code', 'Customer Name', 'Our vendor', 'Status', 'Invoice No',
      'Charged Weight (sheet)', 'Charged Weight (ours)', 'Diff', 'Invoice Value (sheet)', 'Invoice Value (ours)', 'Diff',
      'Dest pincode (sheet)', 'Dest pincode (ours)', 'EDL (sheet)', 'EDL (ours)', 'Diff', 'Total ex-GST (sheet)', 'Total ex-GST (ours)', 'Diff', 'Differences'];
    const body = res.rows.map((r) => [r.vendorCode, r.awb, r.forwardingNo, r.ourAwb ?? '', r.customerCode ?? '', r.customerName ?? '', r.ourVendor ?? '', r.status ?? '', r.invoiceNo ?? '',
      r.chargeWeight, r.ourChargeWeight, r.diffChargeWeight, r.invoiceValue, r.ourInvoiceValue, r.diffInvoiceValue,
      r.destPincode, r.ourDestPincode ?? '', r.edl, r.ourEdl, r.diffEdl, r.totalExGst, r.ourTotalExGst, r.diffTotalExGst, r.issues.join(', ') || 'OK']);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), 'Reconciliation');
    XLSX.writeFile(wb, `vendor-pnl-check-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="card">
      <h2>🔍 Check a vendor P&amp;L sheet against our billing</h2>
      <p className="muted" style={{ fontSize: 12 }}>Columns: Vendor code · AWB No · Forwarding no · Charged Weight · Invoice Value · destination pincode · EDL Charges · Total Sales excluding GST.
        Each row is matched on <b>forwarding no</b> (falls back to AWB) and compared with the customer invoice line we billed. Nothing is saved.</p>
      <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
      {busy && <div className="muted" style={{ marginTop: 8 }}>Checking {fileName}…</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {res && (
        <>
          <div className="row" style={{ gap: 16, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span><b>{res.count}</b> rows</span>
            <span><b>{res.matched}</b> matched</span>
            <span style={{ color: 'var(--bad, #c0392b)' }}><b>{res.withDifferences}</b> with differences</span>
            <label className="row" style={{ gap: 6, alignItems: 'center', margin: 0 }}><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} style={{ width: 'auto' }} /> Only differences</label>
            <button className="secondary" onClick={exportXls}>⬇ Excel</button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Diff = sheet − ours. Red = sheet is higher.</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Forwarding no</th><th>Our AWB</th><th>Customer</th><th>Invoice</th><th>Chrg wt</th><th>Δ</th><th>Inv value</th><th>Δ</th><th>Dest PIN</th><th>EDL</th><th>Δ</th><th>Total ex-GST</th><th>Δ</th><th>Differences</th></tr></thead>
              <tbody>
                {shown.slice(0, 1000).map((r, i) => (
                  <tr key={i}>
                    <td>{r.forwardingNo || r.awb}</td>
                    <td>{r.ourAwb ?? '—'}</td>
                    <td>{r.customerCode ?? '—'}</td>
                    <td>{r.invoiceNo ?? '—'}</td>
                    <td>{num(r.chargeWeight)} <span className="muted">/ {num(r.ourChargeWeight)}</span></td><td>{dcell(r.diffChargeWeight)}</td>
                    <td>{num(r.invoiceValue)} <span className="muted">/ {num(r.ourInvoiceValue)}</span></td><td>{dcell(r.diffInvoiceValue)}</td>
                    <td>{r.destPincode || '—'}{r.ourDestPincode && r.ourDestPincode !== r.destPincode ? <span style={{ color: 'var(--bad, #c0392b)' }}> / {r.ourDestPincode}</span> : null}</td>
                    <td>{num(r.edl)} <span className="muted">/ {num(r.ourEdl)}</span></td><td>{dcell(r.diffEdl)}</td>
                    <td>{num(r.totalExGst)} <span className="muted">/ {num(r.ourTotalExGst)}</span></td><td>{dcell(r.diffTotalExGst)}</td>
                    <td>{r.issues.length ? <span className="badge EXCEPTION">{r.issues.join(', ')}</span> : <span className="badge DELIVERED">OK</span>}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={14} className="muted">No differences — every row matches our billing.</td></tr>}
              </tbody>
            </table>
          </div>
          {shown.length > 1000 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Showing the first 1,000 — the Excel has all {shown.length}.</div>}
        </>
      )}
    </div>
  );
}
