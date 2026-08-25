import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Credit, Invoice } from '../api';
import { useAuth } from '../auth';

export function Invoices() {
  const { user } = useAuth();
  const isFinance = user?.role === 'FINANCE_EXEC' || user?.role === 'SYS_ADMIN';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [fClient, setFClient] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // default the client id: client admins use their own; finance defaults to demo client 1
  const defaultClientId = Number(user?.clientId ?? 1);
  const [clientId, setClientId] = useState(defaultClientId);
  const now = new Date();
  const [periodStart, setPeriodStart] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  );
  const [scope, setScope] = useState<'SINGLE' | 'MULTIPLE' | 'ALL'>('SINGLE');
  const [pickIds, setPickIds] = useState<number[]>([]);
  const [genBusy, setGenBusy] = useState(false);

  const load = () => {
    api.listInvoices().then(setInvoices).catch((e) => setError(e.message));
    api.getCredit(defaultClientId).then(setCredit).catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => { api.listClients().then(setClients).catch(() => {}); }, []);

  // filtered invoices for the printing list
  const num = (v: any) => Number(v ?? 0);
  const filtered = invoices.filter((inv) => {
    if (fClient && String(inv.client?.accountCode) !== fClient) return false;
    const d = inv.periodEnd?.slice(0, 10) ?? '';
    if (fFrom && d < fFrom) return false;
    if (fTo && d > fTo) return false;
    const s = q.trim().toLowerCase();
    if (s && !(inv.invoiceNo.toLowerCase().includes(s) || String(inv.client?.legalName ?? '').toLowerCase().includes(s))) return false;
    return true;
  });
  const totSub = filtered.reduce((a, i) => a + num(i.subtotal), 0);
  const totTax = filtered.reduce((a, i) => a + num(i.tax), 0);
  const totAmt = filtered.reduce((a, i) => a + num(i.total), 0);

  const exportXls = async () => {
    const XLSX = await import('xlsx');
    const head = ['Invoice No', 'From', 'To', 'Code', 'Customer', 'Subtotal', 'Tax', 'Total', 'Status'];
    const rows = filtered.map((i) => [i.invoiceNo, i.periodStart?.slice(0, 10), i.periodEnd?.slice(0, 10), i.client?.accountCode ?? '', i.client?.legalName ?? '', num(i.subtotal), num(i.tax), num(i.total), i.status]);
    const totals = ['', '', '', '', 'TOTAL', totSub, totTax, totAmt, ''];
    const ws = XLSX.utils.aoa_to_sheet([['Invoice list'], [], head, ...rows, [], totals]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
    XLSX.writeFile(wb, `invoices-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const printAll = () => { filtered.slice(0, 30).forEach((i) => window.open(`/invoices/${i.id}/print`, '_blank')); };

  // Head-wise charge-breakup Excel (freight/fuel/fov/oda/docket/handling/awb/…).
  const [bkBusy, setBkBusy] = useState(false);
  const chargeBreakupXls = async () => {
    setError(''); setMsg(''); setBkBusy(true);
    try {
      const clientId = fClient ? clients.find((c) => c.accountCode === fClient)?.id : undefined;
      const data = await api.chargeBreakup(clientId, fFrom || undefined, fTo || undefined);
      if (!data.rows.length) { setError('No billed AWBs match these filters — generate an invoice first, or widen the date range.'); return; }
      const XLSX = await import('xlsx');
      const dd = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '');
      const headCols = data.heads;

      // Sheet 1 — per-AWB detail
      const head1 = ['SNo', 'Invoice No.', 'AWB No.', 'Booking Date', 'Destination', 'Vendor', 'Product', 'Chg. Wt (kg)',
        ...headCols.map((h) => h.label), 'Taxable Value', 'GST %', 'GST Amount', 'Total'];
      const body1 = data.rows.map((r, i) => [
        i + 1, r.invoiceNo, r.awb, dd(r.bookingDate), r.destination, r.vendor, r.product, r.chargeableKg,
        ...headCols.map((h) => r.heads[h.key] ?? 0), r.taxable, `${r.gstPct}%`, r.gst, r.total,
      ]);
      const s = data.summary;
      const totalRow = ['', '', `TOTAL — ${s.awbs} AWBs`, '', '', '', '', s.chargeableKg,
        ...headCols.map((h) => s.headTotals[h.key] ?? 0), s.taxable, '', +(s.cgst + s.sgst + s.igst).toFixed(2), s.grandTotal];
      const ws1 = XLSX.utils.aoa_to_sheet([['Charge Breakup — billed AWBs'], [], head1, ...body1, [], totalRow]);
      ws1['!cols'] = head1.map((h) => ({ wch: Math.max(10, String(h).length + 2) }));

      // Sheet 2 — head-wise summary
      const sumRows: any[][] = [
        ['Customer', data.client ? `${data.client.legalName} (${data.client.accountCode})` : 'All customers'],
        ['Period', `${data.from ? dd(data.from) : '—'} to ${data.to ? dd(data.to) : '—'}`],
        ['Invoices', s.invoices], ['AWBs', s.awbs], ['Chargeable Weight (kg)', s.chargeableKg], [],
        ...headCols.map((h) => [h.label, s.headTotals[h.key] ?? 0]),
        ['Taxable Value', s.taxable], ['CGST', s.cgst], ['SGST', s.sgst], ['IGST', s.igst], ['Grand Total', s.grandTotal],
      ];
      const ws2 = XLSX.utils.aoa_to_sheet([['Charge Summary'], [], ...sumRows]);
      ws2['!cols'] = [{ wch: 26 }, { wch: 34 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Charge Breakup');
      XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
      const tag = data.client?.accountCode ?? 'all';
      XLSX.writeFile(wb, `charge-breakup-${tag}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setMsg(`✓ Exported ${s.awbs} AWBs across ${s.invoices} invoice(s).`);
    } catch (e: any) { setError(e.message); } finally { setBkBusy(false); }
  };

  const generate = async () => {
    setError('');
    setMsg('');
    setGenBusy(true);
    try {
      if (scope === 'SINGLE') {
        if (!clientId) { setError('Pick a customer.'); return; }
        const res = await api.generateInvoice(clientId, periodStart, periodEnd);
        setMsg(`Draft ${res.invoice.invoiceNo} created — total ₹${res.invoice.total}. Review AWBs, then 🔒 Lock to issue it.`);
      } else {
        const ids = scope === 'MULTIPLE' ? pickIds : [];
        if (scope === 'MULTIPLE' && !ids.length) { setError('Select at least one customer.'); return; }
        const res = await api.generateInvoiceBatch(scope, ids, periodStart, periodEnd);
        const errs = res.results.filter((r) => !r.ok);
        const errNote = errs.length ? ` · ${errs.length} skipped (${[...new Set(errs.map((e) => e.error))].slice(0, 2).join('; ')})` : '';
        setMsg(`Generated ${res.created} draft invoice(s) · ₹${res.totalBilled.toLocaleString('en-IN')} · review & 🔒 Lock each to issue${errNote}`);
      }
      load();
    } catch (e: any) {
      setError(e.message);
    } finally { setGenBusy(false); }
  };
  const togglePick = (id: number) => setPickIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const billableClients = clients.filter((c) => !c.isCash && c.accountType !== 'WALLET');

  // #5 lock (issue) · #4 delete · #8 add AWB to a DRAFT invoice
  const lockInv = async (inv: any) => {
    if (!confirm(`Lock invoice ${inv.invoiceNo}? It will be posted to the customer's ledger and can no longer be edited.`)) return;
    setError(''); setMsg('');
    try { const r = await api.lockInvoice(String(inv.id)); setMsg(`🔒 ${inv.invoiceNo} locked${r.creditHold ? ' — customer now on CREDIT HOLD' : ''}.`); load(); }
    catch (e: any) { setError(e.message); }
  };
  const delInv = async (inv: any) => {
    if (!confirm(`Delete invoice ${inv.invoiceNo}?${inv.status !== 'DRAFT' ? '\n\nThis will REVERSE its ledger charge and free its AWBs to be billed again.' : ''}`)) return;
    setError(''); setMsg('');
    try { const r = await api.deleteInvoice(String(inv.id)); setMsg(r.message); load(); }
    catch (e: any) { setError(e.message); }
  };
  const addAwb = async (inv: any) => {
    const awb = window.prompt(`Add an AWB to draft invoice ${inv.invoiceNo}:`);
    if (!awb || !awb.trim()) return;
    setError(''); setMsg('');
    try { const r = await api.addAwbToInvoice(String(inv.id), awb.trim()); setMsg(`${r.message} — ${r.lineCount} AWB(s), new total ₹${r.total.toLocaleString('en-IN')}.`); load(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Invoices</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      {credit && (
        <div className="card">
          <h2>Credit — {credit.legalName}</h2>
          <div className="grid cols-3">
            <div><label>Limit</label>₹{credit.creditLimit}</div>
            <div><label>Outstanding</label>₹{credit.outstandingBalance}</div>
            <div><label>Available</label>₹{credit.available.toFixed(2)}</div>
            <div><label>Terms</label>Net {credit.creditDays}</div>
            <div><label>Status</label>{credit.isCreditHold ? <span className="badge PARTIAL">CREDIT HOLD</span> : <span className="badge DELIVERED">OK</span>}</div>
          </div>
        </div>
      )}

      {isFinance && (
        <div className="card">
          <h2>Generate consolidated invoice</h2>
          {/* #5 scope: one customer, a chosen set, or every eligible customer for the period */}
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {([['SINGLE', '👤 Single customer'], ['MULTIPLE', '👥 Multiple customers'], ['ALL', '🏢 All customers']] as const).map(([k, label]) => (
              <button key={k} type="button" className={scope === k ? '' : 'secondary'} onClick={() => setScope(k)} style={{ padding: '7px 14px' }}>{label}</button>
            ))}
          </div>
          <div className="grid cols-3">
            {scope === 'SINGLE' && (
              <div>
                <label>Customer</label>
                <select value={clientId} onChange={(e) => setClientId(+e.target.value)}>
                  <option value={0}>— select customer —</option>
                  {billableClients.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
                </select>
              </div>
            )}
            <div><label>Period start</label><input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
            <div><label>Period end</label><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
          </div>

          {scope === 'MULTIPLE' && (
            <div style={{ marginTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Select customers <span className="muted">({pickIds.length} selected)</span></label>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setPickIds(billableClients.map((c) => Number(c.id)))}>Select all</button>
                  <button type="button" className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setPickIds([])}>Clear</button>
                </div>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line, #d7dadf)', borderRadius: 8, padding: 8, marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 4 }}>
                {billableClients.map((c) => (
                  <label key={c.id} className="row" style={{ gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={pickIds.includes(Number(c.id))} onChange={() => togglePick(Number(c.id))} />
                    <span>{c.accountCode} — {c.legalName}</span>
                  </label>
                ))}
                {billableClients.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No billable customers loaded.</span>}
              </div>
            </div>
          )}

          {scope === 'ALL' && (
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Bills <strong>every customer</strong> with shipments in this period (cash/wallet prepaid accounts are skipped automatically). Customers with nothing to bill are skipped without error.</p>
          )}

          <button style={{ marginTop: 12 }} onClick={generate} disabled={genBusy}>
            {genBusy ? 'Generating…' : scope === 'SINGLE' ? 'Generate invoice' : scope === 'MULTIPLE' ? `Generate for ${pickIds.length || '—'} customer(s)` : 'Generate for all customers'}
          </button>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0 }}>🧾 Invoice printing</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" onClick={() => { setFClient(''); setFFrom(''); setFTo(''); setQ(''); }}>Reset</button>
            <button className="secondary" onClick={exportXls} disabled={!filtered.length}>⬇ Excel</button>
            <button className="secondary" onClick={chargeBreakupXls} disabled={bkBusy} title="Head-wise charge breakup (freight/fuel/FOV/ODA/…) of billed AWBs">{bkBusy ? 'Exporting…' : '⬇ Charge breakup'}</button>
            <button onClick={printAll} disabled={!filtered.length}>🖨 Print all</button>
          </div>
        </div>
        <div className="grid cols-4" style={{ gap: 10, marginTop: 10 }}>
          <div><label style={{ fontSize: 12 }}>Customer</label>
            <select value={fClient} onChange={(e) => setFClient(e.target.value)}>
              <option value="">All customers</option>
              {clients.map((c) => <option key={c.id} value={c.accountCode}>{c.accountCode} — {c.legalName}</option>)}
            </select>
          </div>
          <div><label style={{ fontSize: 12 }}>From</label><input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></div>
          <div><label style={{ fontSize: 12 }}>To</label><input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} /></div>
          <div><label style={{ fontSize: 12 }}>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="invoice no / customer" /></div>
        </div>

        <div className="row" style={{ gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
          {[['Invoices', filtered.length], ['Subtotal', `₹${totSub.toLocaleString('en-IN')}`], ['Tax', `₹${totTax.toLocaleString('en-IN')}`], ['Total', `₹${totAmt.toLocaleString('en-IN')}`]].map(([k, v]) => (
            <div key={String(k)} style={{ background: 'var(--bg-soft, #f2f4f7)', borderRadius: 8, padding: '6px 12px', fontSize: 13 }}><b className="muted">{k}:</b> {v}</div>
          ))}
        </div>

        {filtered.length === 0 ? (
          invoices.length === 0
            ? <p className="muted">No invoices yet — use <b>Generate consolidated invoice</b> above to bill a customer's delivered shipments for a period, and it'll show up here.</p>
            : <p className="muted">No invoices match these filters. <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { setFClient(''); setFFrom(''); setFTo(''); setQ(''); }}>Clear filters</button></p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Invoice No</th><th>From</th><th>To</th><th>Code</th><th>Customer</th><th style={{ textAlign: 'right' }}>Subtotal</th><th style={{ textAlign: 'right' }}>Tax</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id}>
                    <td><Link to={`/invoices/${inv.id}`}><strong>{inv.invoiceNo}</strong></Link></td>
                    <td>{inv.periodStart.slice(0, 10)}</td>
                    <td>{inv.periodEnd.slice(0, 10)}</td>
                    <td>{inv.client?.accountCode ?? '—'}</td>
                    <td>{inv.client?.legalName ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>₹{num(inv.subtotal).toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right' }}>₹{num(inv.tax).toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right' }}><strong>₹{num(inv.total).toLocaleString('en-IN')}</strong></td>
                    <td><span className={`badge ${inv.status}`}>{inv.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link to={`/invoices/${inv.id}`}><button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="View / edit AWBs">👁</button></Link>
                      <a href={`/invoices/${inv.id}/print`} target="_blank" rel="noreferrer"><button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Print">🖨</button></a>
                      {isFinance && inv.status === 'DRAFT' && <>
                        <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Add an AWB" onClick={() => addAwb(inv)}>＋AWB</button>
                        <button style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Lock / issue this invoice" onClick={() => lockInv(inv)}>🔒 Lock</button>
                      </>}
                      {isFinance && inv.status !== 'PAID' && inv.status !== 'PARTIALLY_PAID' && (
                        <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, color: 'var(--danger, #c0392b)' }} title="Delete invoice" onClick={() => delInv(inv)}>🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr><td colSpan={5} style={{ textAlign: 'right' }}><strong>TOTAL</strong></td><td style={{ textAlign: 'right' }}><strong>₹{totSub.toLocaleString('en-IN')}</strong></td><td style={{ textAlign: 'right' }}><strong>₹{totTax.toLocaleString('en-IN')}</strong></td><td style={{ textAlign: 'right' }}><strong>₹{totAmt.toLocaleString('en-IN')}</strong></td><td colSpan={2}></td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
