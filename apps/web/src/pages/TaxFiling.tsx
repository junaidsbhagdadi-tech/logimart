import { useState } from 'react';
import { api } from '../api';

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Turn an array of objects into a CSV file download. */
function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TaxFiling() {
  const [tab, setTab] = useState<'gst' | 'tds'>('gst');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [gst, setGst] = useState<any>(null);
  const [tds, setTds] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setError('');
    setBusy(true);
    try {
      if (tab === 'gst') setGst(await api.gstReport(from, to));
      else setTds(await api.tdsReport(from, to));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Tax Filing</h1>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div>
            <label>Report</label>
            <select value={tab} onChange={(e) => setTab(e.target.value as any)}>
              <option value="gst">GST — GSTR-1 / 3B (outward supplies)</option>
              <option value="tds">TDS — deductee register (26Q)</option>
            </select>
          </div>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button disabled={busy} onClick={run}>{busy ? 'Running…' : 'Generate'}</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Prepares return-ready data from your invoices &amp; ledger. Export the CSV and upload/enter on the
          GST / TRACES portal (or hand to your CA). Live e-filing needs a GSP — this readies the figures.
        </p>
      </div>

      {tab === 'gst' && gst && (
        <>
          <div className="card">
            <h2>GSTR-3B summary · {gst.period.from} → {gst.period.to}</h2>
            <div className="grid cols-3">
              <div><label>Invoices</label>{gst.count}</div>
              <div><label>Taxable value</label>₹{gst.summary.taxableValue.toLocaleString('en-IN')}</div>
              <div><label>Total tax</label>₹{gst.summary.totalTax.toLocaleString('en-IN')}</div>
              <div><label>CGST</label>₹{gst.summary.cgst.toLocaleString('en-IN')}</div>
              <div><label>SGST</label>₹{gst.summary.sgst.toLocaleString('en-IN')}</div>
              <div><label>IGST</label>₹{gst.summary.igst.toLocaleString('en-IN')}</div>
            </div>
          </div>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>GSTR-1 outward supplies ({gst.rows.length})</h2>
              <div className="row">
                <button className="secondary" disabled={!gst.rows.length} onClick={() => downloadCsv(`GSTR1_${from}_${to}.csv`, gst.rows)}>⬇ Export CSV</button>
                <button disabled={!gst.rows.length} onClick={() => api.exportTally(from, to).catch((e) => setError(e.message))}>📗 Export to Tally</button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Invoice</th><th>Date</th><th>Customer GSTIN</th><th>POS</th><th>SAC</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead>
                <tbody>
                  {gst.rows.map((r: any) => (
                    <tr key={r.invoiceNo}>
                      <td>{r.invoiceNo}</td><td>{r.date?.slice(0, 10)}</td><td>{r.gstin}</td><td>{r.placeOfSupply}</td><td>{r.sacCode}</td>
                      <td>₹{r.taxableValue}</td><td>₹{r.cgst}</td><td>₹{r.sgst}</td><td>₹{r.igst}</td><td>₹{r.total}</td>
                    </tr>
                  ))}
                  {gst.rows.length === 0 && <tr><td colSpan={10} className="muted">No invoices in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'tds' && tds && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>TDS receivable — deducted by customers (194C) · ₹{tds.receivable.total.toLocaleString('en-IN')}</h2>
              <button className="secondary" disabled={!tds.receivable.rows.length} onClick={() => downloadCsv(`TDS_receivable_${from}_${to}.csv`, tds.receivable.rows)}>⬇ Export CSV</button>
            </div>
            <table>
              <thead><tr><th>Deductor (customer)</th><th>GSTIN</th><th>PAN</th><th>TDS</th></tr></thead>
              <tbody>
                {tds.receivable.rows.map((r: any, i: number) => (
                  <tr key={i}><td>{r.deductor}</td><td>{r.gstin ?? '—'}</td><td>{r.pan ?? '—'}</td><td>₹{r.tds}</td></tr>
                ))}
                {tds.receivable.rows.length === 0 && <tr><td colSpan={4} className="muted">No TDS deducted by customers in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>TDS payable — Form 26Q (deducted by us on vendors) · ₹{tds.payable.total.toLocaleString('en-IN')}</h2>
              <button className="secondary" disabled={!tds.payable.rows.length} onClick={() => downloadCsv(`Form26Q_${from}_${to}.csv`, tds.payable.rows)}>⬇ Export CSV</button>
            </div>
            <table>
              <thead><tr><th>Deductee (vendor)</th><th>PAN</th><th>Section</th><th>Amount paid</th><th>TDS</th></tr></thead>
              <tbody>
                {tds.payable.rows.map((r: any, i: number) => (
                  <tr key={i}><td>{r.deductee}</td><td>{r.pan ?? '—'}</td><td>{r.section}</td><td>₹{r.amount}</td><td>₹{r.tds}</td></tr>
                ))}
                {tds.payable.rows.length === 0 && <tr><td colSpan={5} className="muted">No vendor TDS in this period. (Enter TDS when recording a vendor payment.)</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
