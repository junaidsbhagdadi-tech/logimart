import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Credit, Invoice } from '../api';
import { useAuth } from '../auth';
import { useRights } from '../rights';

export function Invoices() {
  const { user } = useAuth();
  const isFinance = user?.role === 'FINANCE_EXEC' || user?.role === 'SYS_ADMIN';
  const rights = useRights('/invoices');
  const isSuper = user?.role === 'SYS_ADMIN';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credit, setCredit] = useState<Credit | null>(null);
  // #11 — configurable invoice-number series (CONFIG/INVOICE_SERIES { prefix, nextNo, pad, fromDate }).
  const [invCfg, setInvCfg] = useState({ prefix: '', nextNo: '1', pad: '5', fromDate: '', active: false });
  const [showInvCfg, setShowInvCfg] = useState(false);
  useEffect(() => {
    if (!isSuper) return;
    api.listMaster('CONFIG').then((rows) => {
      const r = rows.find((x) => x.code === 'INVOICE_SERIES');
      if (r) setInvCfg({ prefix: String(r.attrs?.prefix ?? ''), nextNo: String(r.attrs?.nextNo ?? '1'), pad: String(r.attrs?.pad ?? '5'), fromDate: String(r.attrs?.fromDate ?? ''), active: r.active !== false });
    }).catch(() => {});
  }, [isSuper]);
  const saveInvCfg = async () => {
    const prefix = invCfg.prefix.trim();
    const nextNo = Math.max(1, Number(invCfg.nextNo) || 1);
    const pad = Math.max(1, Math.min(12, Number(invCfg.pad) || 5));
    try {
      await api.saveMaster('CONFIG', { code: 'INVOICE_SERIES', name: prefix || 'Invoice series', attrs: { prefix, nextNo, pad, fromDate: invCfg.fromDate || null }, active: invCfg.active && !!prefix });
      setMsg(invCfg.active && prefix ? `Invoices will number as ${prefix}${String(nextNo).padStart(pad, '0')}, ${prefix}${String(nextNo + 1).padStart(pad, '0')}…` : 'Custom invoice series disabled — using the default INV-… format.');
      setShowInvCfg(false);
    } catch (e: any) { setError(e.message); }
  };
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

  // Bulk lock (single / multiple / all) + bulk e-invoice
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const lockSelected = async () => {
    const ids = [...sel]; if (!ids.length) return;
    if (!confirm(`Lock ${ids.length} invoice(s)? Each is posted to its ledger and frozen.`)) return;
    setError(''); setMsg('');
    try { const r = await api.lockManyInvoices({ ids }); setMsg(`🔒 Locked ${r.locked} invoice(s)${r.skipped.length ? ` · skipped ${r.skipped.length} (already locked/empty)` : ''}.`); setSel(new Set()); load(); }
    catch (e: any) { setError(e.message); }
  };
  const lockAllDrafts = async () => {
    if (!confirm('Lock ALL draft invoices? Each is posted to its ledger and frozen.')) return;
    setError(''); setMsg('');
    try { const r = await api.lockManyInvoices({ all: true }); setMsg(`🔒 Locked ${r.locked} draft invoice(s)${r.skipped.length ? ` · skipped ${r.skipped.length}` : ''}.`); setSel(new Set()); load(); }
    catch (e: any) { setError(e.message); }
  };
  const einvoiceSelected = async () => {
    const ids = [...sel]; if (!ids.length) return;
    setError(''); setMsg('');
    try { const r = await api.einvoiceManyInvoices(ids); setMsg(`🧾 e-invoice generated for ${r.done} invoice(s)${r.failed.length ? ` · ${r.failed.length} failed` : ''}.`); load(); }
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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Invoices</h1>
        {isSuper && <button className="secondary" onClick={() => setShowInvCfg((v) => !v)} title="Set a fixed invoice-number series">🔢 Invoice number series</button>}
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}
      {isSuper && showInvCfg && (
        <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>🔢 Invoice number series</strong>
            <label className="row" style={{ gap: 6, fontSize: 13, margin: 0 }}><input type="checkbox" checked={invCfg.active} onChange={(e) => setInvCfg((c) => ({ ...c, active: e.target.checked }))} /> Use this series</label>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>When on, new invoices number as <b>Prefix + running number</b> (skips any already-used number — GST requires unique, non-reused numbers). When off, the default <code>INV-CODE-YYYY-MM</code> format is used.</p>
          <div className="grid cols-4" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div><label>Prefix</label><input value={invCfg.prefix} onChange={(e) => setInvCfg((c) => ({ ...c, prefix: e.target.value }))} placeholder="e.g. EXL/25-26/" /></div>
            <div><label>Next number</label><input type="number" value={invCfg.nextNo} onChange={(e) => setInvCfg((c) => ({ ...c, nextNo: e.target.value }))} /></div>
            <div><label>Digits (padding)</label><input type="number" value={invCfg.pad} onChange={(e) => setInvCfg((c) => ({ ...c, pad: e.target.value }))} /></div>
            <div><label>Effective from</label><input type="date" value={invCfg.fromDate} onChange={(e) => setInvCfg((c) => ({ ...c, fromDate: e.target.value }))} /></div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>Next invoice: <b>{(invCfg.prefix || '—')}{String(Math.max(1, Number(invCfg.nextNo) || 1)).padStart(Math.max(1, Math.min(12, Number(invCfg.pad) || 5)), '0')}</b></span>
            <button onClick={saveInvCfg}>Save series</button>
          </div>
        </div>
      )}

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

      {isFinance && rights.edit && (
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

        {isFinance && rights.edit && (
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {sel.size > 0 && <span className="muted" style={{ fontSize: 13 }}><strong>{sel.size}</strong> selected</span>}
            <button className="secondary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={!sel.size} onClick={lockSelected}>🔒 Lock selected</button>
            <button className="secondary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={!sel.size} onClick={einvoiceSelected} title="Generate GST e-invoice IRNs for the selected invoices">🧾 e-Invoice selected</button>
            <button className="secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={lockAllDrafts} title="Lock every draft invoice">🔒 Lock ALL drafts</button>
          </div>
        )}

        {filtered.length === 0 ? (
          invoices.length === 0
            ? <p className="muted">No invoices yet — use <b>Generate consolidated invoice</b> above to bill a customer's delivered shipments for a period, and it'll show up here.</p>
            : <p className="muted">No invoices match these filters. <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { setFClient(''); setFFrom(''); setFTo(''); setQ(''); }}>Clear filters</button></p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>{isFinance && <th style={{ width: 30 }}><input type="checkbox" checked={filtered.length > 0 && filtered.every((i) => sel.has(String(i.id)))} onChange={(e) => setSel(e.target.checked ? new Set(filtered.map((i) => String(i.id))) : new Set())} style={{ width: 'auto' }} /></th>}<th>Invoice No</th><th>From</th><th>To</th><th>Code</th><th>Customer</th><th style={{ textAlign: 'right' }}>Subtotal</th><th style={{ textAlign: 'right' }}>Tax</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id}>
                    {isFinance && <td><input type="checkbox" checked={sel.has(String(inv.id))} onChange={() => toggleSel(String(inv.id))} style={{ width: 'auto' }} /></td>}
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
                      {isFinance && rights.edit && inv.status === 'DRAFT' && <>
                        <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Add an AWB" onClick={() => addAwb(inv)}>＋AWB</button>
                        <button style={{ padding: '3px 8px', fontSize: 12, marginRight: 4 }} title="Lock / issue this invoice" onClick={() => lockInv(inv)}>🔒 Lock</button>
                      </>}
                      {isFinance && rights.del && inv.status !== 'PAID' && inv.status !== 'PARTIALLY_PAID' && (
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
