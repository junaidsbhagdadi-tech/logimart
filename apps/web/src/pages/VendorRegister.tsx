import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/**
 * Vendor bill register — the vendors' own invoices to us (vendor code, period, invoice date, location,
 * invoice no, amount, GST, grand total, due date) and the payments that settle them. One payment can
 * clear several invoices of one vendor. Filter, then export to Excel or print / save as PDF.
 */
const money = (v: any) => `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (v?: string | null) => (v ? String(v).slice(0, 10).split('-').reverse().join('-') : '—');
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const blank = { vendorCode: '', periodFrom: '', periodTo: '', invoiceDate: today(), location: '', invoiceNo: '', amount: '', gst: '', grandTotal: '', dueDate: '' };

export function VendorRegister() {
  const [vendors, setVendors] = useState<{ code: string; name: string }[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ vendorCode: '', from: '', to: '', status: '' });
  const [form, setForm] = useState({ ...blank });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pay, setPay] = useState<{ paidOn: string; amount: string; tds: string; other: string; otherNote: string; mode: string; reference: string } | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [showPays, setShowPays] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { api.listVendors().then((v: any[]) => setVendors(v.filter((x) => x.isActive !== false).map((x) => ({ code: x.vendorCode, name: x.name })))).catch(() => {}); }, []);
  const load = () => {
    api.vendorRegister(f).then((r) => { setRows(r); setSel(new Set()); }).catch((e) => setErr(e.message));
    api.vendorBillPayments(f.vendorCode || undefined).then(setPayments).catch(() => {});
  };
  useEffect(load, [f.vendorCode, f.from, f.to, f.status]);

  const setFm = (k: keyof typeof blank, v: string) => setForm((x) => {
    const n = { ...x, [k]: v };
    if ((k === 'amount' || k === 'gst') && (!x.grandTotal || +x.grandTotal === +(+x.amount || 0) + +(+x.gst || 0))) n.grandTotal = String(+((+n.amount || 0) + (+n.gst || 0)).toFixed(2));
    return n;
  });
  const add = async () => {
    setErr(''); setMsg('');
    try { await api.addVendorInvoice(form); setMsg(`✓ Recorded ${form.invoiceNo} of ${form.vendorCode}.`); setForm({ ...blank, vendorCode: form.vendorCode, location: form.location }); load(); }
    catch (e: any) { setErr(e.message); }
  };
  const del = async (r: any) => {
    if (!confirm(`Delete vendor invoice ${r.invoiceNo} (${r.vendorCode})?`)) return;
    try { await api.deleteVendorInvoice(r.id); load(); } catch (e: any) { setErr(e.message); }
  };

  const picked = rows.filter((r) => sel.has(r.id));
  const pickedVendors = [...new Set(picked.map((r) => r.vendorCode))];
  const pickedBal = picked.reduce((s, r) => s + Number(r.balance), 0);
  const toggle = (r: any) => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; });
  const openPay = () => { setErr(''); setPay({ paidOn: today(), amount: pickedBal.toFixed(2), tds: '', other: '', otherNote: '', mode: 'NEFT', reference: '' }); };
  const settling = pay ? (+pay.amount || 0) + (+pay.tds || 0) + (+pay.other || 0) : 0;
  const submitPay = async () => {
    if (!pay) return;
    try {
      const r = await api.recordVendorBillPayment({ invoiceIds: picked.map((x) => x.id), ...pay, amount: +pay.amount || 0, tds: +pay.tds || 0, other: +pay.other || 0 });
      setMsg(`✓ Payment recorded — settled ${r.settled.map((s: any) => `${s.invoiceNo} ${money(s.amount)}`).join(', ')}${r.unallocated > 0 ? ` · ${money(r.unallocated)} more than the balance was not allocated` : ''}.`);
      setPay(null); load();
    } catch (e: any) { setErr(e.message); }
  };
  const delPayment = async (p: any) => {
    if (!confirm(`Delete this payment of ${money(p.amount)}? The invoices it settled become unpaid again.`)) return;
    try { await api.deleteVendorBillPayment(p.id); load(); } catch (e: any) { setErr(e.message); }
  };

  const tot = useMemo(() => rows.reduce((a, r) => ({ amount: a.amount + Number(r.amount), gst: a.gst + Number(r.gst), grand: a.grand + Number(r.grandTotal), bal: a.bal + Number(r.balance) }), { amount: 0, gst: 0, grand: 0, bal: 0 }), [rows]);
  const lastPay = (r: any) => r.payments?.length ? r.payments[r.payments.length - 1] : null;

  const exportXls = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({
      'Vendor code': r.vendorCode, Vendor: r.vendorName ?? '', 'Period from': dmy(r.periodFrom), 'Period to': dmy(r.periodTo), 'Invoice date': dmy(r.invoiceDate),
      Location: r.location ?? '', 'Vendor inv no': r.invoiceNo, 'Total amount': Number(r.amount), GST: Number(r.gst), 'G Total': Number(r.grandTotal), 'Due date': dmy(r.dueDate),
      Paid: Number(r.settled), Balance: Number(r.balance), Status: r.status, 'Paid on': r.payments.map((p: any) => `${dmy(p.paidOn)} ${p.reference ?? ''}`.trim()).join('; '),
    }))), 'Vendor bills');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payments.map((p) => ({
      Vendor: p.vendorCode, 'Paid on': dmy(p.paidOn), Paid: Number(p.amount), TDS: Number(p.tds), Other: Number(p.other), 'Other note': p.otherNote ?? '', Mode: p.mode ?? '', Reference: p.reference ?? '',
      Invoices: p.invoices.map((i: any) => `${i.invoiceNo} (${Number(i.amount).toFixed(2)})`).join(', '),
    }))), 'Payments');
    XLSX.writeFile(wb, `Vendor-bills-${f.vendorCode || 'all'}-${today()}.xlsx`);
  };

  return (
    <>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      <div className="card no-print">
        <h2 style={{ marginTop: 0 }}>＋ Record a vendor bill</h2>
        <div className="grid cols-4" style={{ gap: 10 }}>
          <div><label>Vendor code *</label>
            <select value={form.vendorCode} onChange={(e) => setFm('vendorCode', e.target.value)}>
              <option value="">— vendor —</option>
              {vendors.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
            </select>
          </div>
          <div><label>Period from</label><input type="date" value={form.periodFrom} onChange={(e) => setFm('periodFrom', e.target.value)} /></div>
          <div><label>Period to</label><input type="date" value={form.periodTo} onChange={(e) => setFm('periodTo', e.target.value)} /></div>
          <div><label>Invoice date *</label><input type="date" value={form.invoiceDate} onChange={(e) => setFm('invoiceDate', e.target.value)} /></div>
          <div><label>Location</label><input value={form.location} onChange={(e) => setFm('location', e.target.value)} placeholder="e.g. Mumbai" /></div>
          <div><label>Vendor inv no *</label><input value={form.invoiceNo} onChange={(e) => setFm('invoiceNo', e.target.value)} /></div>
          <div><label>Total amount ₹</label><input type="number" value={form.amount} onChange={(e) => setFm('amount', e.target.value)} /></div>
          <div><label>GST ₹</label><input type="number" value={form.gst} onChange={(e) => setFm('gst', e.target.value)} /></div>
          <div><label>G Total ₹</label><input type="number" value={form.grandTotal} onChange={(e) => setFm('grandTotal', e.target.value)} /></div>
          <div><label>Due date</label><input type="date" value={form.dueDate} onChange={(e) => setFm('dueDate', e.target.value)} /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.vendorCode || !form.invoiceNo.trim() || !form.invoiceDate || !(+form.grandTotal > 0)} onClick={add}>Save bill</button>
      </div>

      <div className="card print-area">
        <div className="row no-print" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label>Vendor</label>
            <select value={f.vendorCode} onChange={(e) => setF({ ...f, vendorCode: e.target.value })}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.name}</option>)}
            </select>
          </div>
          <div><label>Invoice date from</label><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div><label>to</label><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          <div><label>Status</label>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">All</option><option value="UNPAID">Unpaid (open + part paid)</option><option value="OPEN">Open</option><option value="PARTIAL">Part paid</option><option value="PAID">Paid</option>
            </select>
          </div>
          <button className="secondary" onClick={exportXls} disabled={!rows.length}>⬇ Excel</button>
          <button className="secondary" onClick={() => window.print()} disabled={!rows.length} title="Print or save as PDF">🖨 PDF</button>
          <span style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 12.5 }}>{sel.size ? `${sel.size} selected · balance ${money(pickedBal)}` : 'Tick bills of one vendor to pay them together'}</span>
          <button disabled={!sel.size || pickedVendors.length !== 1 || pickedBal <= 0} onClick={openPay} title={pickedVendors.length > 1 ? 'Pick bills of ONE vendor' : ''}>💳 Record payment</button>
        </div>
        <h2 className="print-only" style={{ margin: '0 0 6px' }}>Vendor bills{f.vendorCode ? ` — ${f.vendorCode}` : ''}{f.from || f.to ? ` · ${dmy(f.from)} → ${dmy(f.to)}` : ''}</h2>

        {pay && (
          <div className="card no-print" style={{ borderLeft: '4px solid var(--navy)', marginTop: 12 }}>
            <h2 style={{ marginTop: 0 }}>Record payment — {pickedVendors[0]} · {picked.map((r) => r.invoiceNo).join(', ')}</h2>
            <div className="grid cols-3" style={{ gap: 10 }}>
              <div><label>Payment date</label><input type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></div>
              <div><label>Amount paid ₹</label><input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
              <div><label>TDS deducted ₹</label><input type="number" value={pay.tds} onChange={(e) => setPay({ ...pay, tds: e.target.value })} /></div>
              <div><label>Other deduction ₹</label><input type="number" value={pay.other} onChange={(e) => setPay({ ...pay, other: e.target.value })} /></div>
              <div style={{ gridColumn: 'span 2' }}><label>Other deduction note</label><input value={pay.otherNote} onChange={(e) => setPay({ ...pay, otherNote: e.target.value })} placeholder="e.g. shortage claim" /></div>
              <div><label>Mode</label>
                <select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash'].map((m) => <option key={m}>{m}</option>)}</select>
              </div>
              <div style={{ gridColumn: 'span 2' }}><label>UTR / cheque no.</label><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Settling <strong>{money(settling)}</strong> of {money(pickedBal)} across {picked.length} bill(s), oldest due first
              {settling >= pickedBal - 0.01 ? ' → all marked PAID' : ' → the last one stays part-paid'}.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={submitPay} disabled={settling <= 0}>Confirm</button>
              <button className="secondary" onClick={() => setPay(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ fontSize: 13 }}>
            <thead><tr>
              <th className="no-print" style={{ width: 28 }} />
              <th>Vendor code</th><th>Period</th><th>Invoice date</th><th>Location</th><th>Vendor inv no</th>
              <th style={{ textAlign: 'right' }}>Total amount</th><th style={{ textAlign: 'right' }}>GST</th><th style={{ textAlign: 'right' }}>G Total</th>
              <th>Due date</th><th style={{ textAlign: 'right' }}>Balance</th><th>Status</th><th className="no-print" />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const overdue = r.status !== 'PAID' && r.dueDate && String(r.dueDate).slice(0, 10) < today();
                const lp = lastPay(r);
                return (
                  <tr key={r.id}>
                    <td className="no-print">{r.status !== 'PAID' && <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(r.id)} onChange={() => toggle(r)} />}</td>
                    <td><strong>{r.vendorCode}</strong>{r.vendorName && <div className="muted" style={{ fontSize: 11 }}>{r.vendorName}</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.periodFrom || r.periodTo ? `${dmy(r.periodFrom)} → ${dmy(r.periodTo)}` : '—'}</td>
                    <td>{dmy(r.invoiceDate)}</td><td>{r.location ?? '—'}</td><td>{r.invoiceNo}</td>
                    <td style={{ textAlign: 'right' }}>{money(r.amount)}</td><td style={{ textAlign: 'right' }}>{money(r.gst)}</td><td style={{ textAlign: 'right' }}><strong>{money(r.grandTotal)}</strong></td>
                    <td style={overdue ? { color: 'var(--bad, #c0392b)', fontWeight: 700 } : undefined}>{dmy(r.dueDate)}</td>
                    <td style={{ textAlign: 'right' }}>{money(r.balance)}</td>
                    <td><span className={`badge ${r.status === 'PAID' ? 'DELIVERED' : r.status === 'PARTIAL' ? 'PARTIAL' : 'AT_HUB'}`}>{r.status === 'PARTIAL' ? 'PART PAID' : r.status}</span>
                      {lp && <div className="muted" style={{ fontSize: 11 }}>{dmy(lp.paidOn)}{lp.reference ? ` · ${lp.reference}` : ''}</div>}</td>
                    <td className="no-print">{!r.payments.length && <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => del(r)} title="Delete">🗑</button>}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={13} className="muted">No vendor bills recorded{f.vendorCode || f.from || f.to || f.status ? ' for this filter' : ' yet — add one above'}.</td></tr>}
              {rows.length > 0 && <tr><td className="no-print" /><td colSpan={5} style={{ textAlign: 'right' }}><strong>TOTAL ({rows.length})</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{money(tot.amount)}</strong></td><td style={{ textAlign: 'right' }}><strong>{money(tot.gst)}</strong></td><td style={{ textAlign: 'right' }}><strong>{money(tot.grand)}</strong></td>
                <td /><td style={{ textAlign: 'right' }}><strong>{money(tot.bal)}</strong></td><td colSpan={2} /></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card no-print">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>💳 Payments {f.vendorCode ? `— ${f.vendorCode}` : ''} ({payments.length})</h2>
          <button className="secondary" onClick={() => setShowPays((x) => !x)}>{showPays ? 'Hide' : 'Show'}</button>
        </div>
        {showPays && (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Paid on</th><th>Vendor</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>TDS</th><th style={{ textAlign: 'right' }}>Other</th><th>Mode / ref</th><th>Invoices settled</th><th /></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dmy(p.paidOn)}</td><td>{p.vendorCode}</td><td style={{ textAlign: 'right' }}>{money(p.amount)}</td><td style={{ textAlign: 'right' }}>{money(p.tds)}</td>
                    <td style={{ textAlign: 'right' }}>{money(p.other)}{p.otherNote ? <div className="muted" style={{ fontSize: 11 }}>{p.otherNote}</div> : null}</td>
                    <td>{[p.mode, p.reference].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.invoices.map((i: any) => `${i.invoiceNo} (${money(i.amount)})`).join(', ')}</td>
                    <td><button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => delPayment(p)} title="Delete payment">🗑</button></td>
                  </tr>
                ))}
                {!payments.length && <tr><td colSpan={8} className="muted">No payments recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <style>{`
        .print-only { display:none; }
        @media print {
          .no-print, nav, aside, header, .sidebar { display:none !important; }
          .print-only { display:block; }
          .print-area { box-shadow:none !important; border:0 !important; }
        }
      `}</style>
    </>
  );
}
