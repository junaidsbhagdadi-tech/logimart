import { useEffect, useState } from 'react';
import { api } from '../api';

const inr = (n: number | string) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash', 'Other'];
const blankPay = { amount: '', tds: '', other: '', otherNote: '', mode: 'NEFT', reference: '' };

export function Receivables() {
  const [aging, setAging] = useState<{ rows: any[]; totals: any } | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [stmt, setStmt] = useState<any | null>(null);
  const [stmtClientId, setStmtClientId] = useState<string | null>(null);
  // Record-payment form for one invoice (posts to the ledger + updates outstanding).
  const [paying, setPaying] = useState<any | null>(null);
  const [pay, setPay] = useState({ ...blankPay });
  const [busy, setBusy] = useState(false);

  const loadAging = () => api.aging().then(setAging).catch((e) => setError(e.message));
  useEffect(() => { loadAging(); }, []);

  const openStatement = async (clientId: string) => {
    setError(''); setStmtClientId(clientId);
    try { setStmt(await api.statement(clientId)); } catch (e: any) { setError(e.message); }
  };

  const openPay = (inv: any) => { setPaying(inv); setPay({ ...blankPay, amount: String(Number(inv.remaining) || '') }); setError(''); setMsg(''); };
  const submitPay = async () => {
    if (!paying) return;
    const amount = Number(pay.amount) || 0, tds = Number(pay.tds) || 0, other = Number(pay.other) || 0;
    if (amount + tds + other <= 0) { setError('Enter the amount received (and/or TDS / other deduction).'); return; }
    setBusy(true); setError('');
    try {
      const reference = [pay.mode, pay.reference.trim()].filter(Boolean).join(' ');
      const r: any = await api.payInvoice(String(paying.id), { amount, tds, other, otherNote: pay.otherNote || undefined, reference } as any);
      setMsg(`✓ Recorded ${inr(amount + tds + other)} against ${paying.invoiceNo}${r?.fullyPaid ? ' — fully paid' : ` — ₹${Number(r?.remaining ?? 0).toLocaleString('en-IN')} still due`}. Ledger updated.`);
      setPaying(null);
      if (stmtClientId) setStmt(await api.statement(stmtClientId));
      loadAging();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const t = aging?.totals;
  return (
    <>
      <h1>Receivables</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      {t && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
          {[
            ['Current', t.current], ['1–30d', t.d1_30], ['31–60d', t.d31_60],
            ['61–90d', t.d61_90], ['90+ d', t.d90_plus], ['Total due', t.total],
          ].map(([label, val], i) => (
            <div key={label} className="card kpi" style={{ flex: 1, minWidth: 110 }}>
              <div className="muted" style={{ fontSize: 12 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: i >= 3 ? 'var(--danger, #b91c1c)' : 'var(--navy)' }}>{inr(val as number)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Aging by client</h2>
        <table>
          <thead><tr><th>Client</th><th>Current</th><th>1–30</th><th>31–60</th><th>61–90</th><th>90+</th><th>Total</th><th></th></tr></thead>
          <tbody>
            {aging?.rows.map((r) => (
              <tr key={r.clientId}>
                <td><strong>{r.legalName}</strong><div className="muted" style={{ fontSize: 11 }}>{r.accountCode}</div></td>
                <td>{inr(r.current)}</td><td>{inr(r.d1_30)}</td><td>{inr(r.d31_60)}</td>
                <td>{inr(r.d61_90)}</td>
                <td>{r.d90_plus > 0 ? <span className="badge EXCEPTION">{inr(r.d90_plus)}</span> : '₹0'}</td>
                <td><strong>{inr(r.total)}</strong></td>
                <td><button className="secondary" onClick={() => openStatement(r.clientId)}>Statement</button></td>
              </tr>
            ))}
            {aging && aging.rows.length === 0 && <tr><td colSpan={8} className="muted">No outstanding receivables. 🎉</td></tr>}
          </tbody>
        </table>
      </div>

      {stmt && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Statement — {stmt.client.legalName}</h2>
            <button className="secondary" onClick={() => setStmt(null)}>Close</button>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Outstanding {inr(stmt.client.outstandingBal)} · Limit {inr(stmt.client.creditLimit)} · Net {stmt.client.creditDays}
            {stmt.client.isCreditHold && <span className="badge PARTIAL" style={{ marginLeft: 8 }}>ON HOLD</span>}
          </p>

          <h3>Invoices</h3>
          <table>
            <thead><tr><th>Invoice</th><th>Period</th><th>Due</th><th>Total</th><th>Remaining</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {stmt.invoices.map((i: any) => (
                <tr key={i.id}>
                  <td>{i.invoiceNo}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{String(i.periodStart).slice(0, 10)} → {String(i.periodEnd).slice(0, 10)}</td>
                  <td>{String(i.dueDate).slice(0, 10)}</td>
                  <td>{inr(i.total)}</td>
                  <td><strong>{inr(i.remaining)}</strong></td>
                  <td>{i.status}</td>
                  <td>{i.status !== 'DRAFT' && i.status !== 'PAID' && Number(i.remaining) > 0.01 && <button style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => openPay(i)}>₹ Record payment</button>}</td>
                </tr>
              ))}
              {stmt.invoices.length === 0 && <tr><td colSpan={7} className="muted">No invoices.</td></tr>}
            </tbody>
          </table>

          {paying && (
            <div className="card" style={{ borderLeft: '4px solid var(--brand)', marginTop: 12 }}>
              <h3 style={{ margin: '0 0 4px' }}>Record payment — {paying.invoiceNo}</h3>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Outstanding on this invoice: <strong>{inr(paying.remaining)}</strong>. TDS and other deductions also clear the receivable. Posted to the ledger as separate entries.</div>
              <div className="grid cols-3" style={{ gap: 10 }}>
                <div><label>Amount received ₹</label><input type="number" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} /></div>
                <div><label>TDS ₹</label><input type="number" value={pay.tds} onChange={(e) => setPay((p) => ({ ...p, tds: e.target.value }))} /></div>
                <div><label>Other deduction ₹</label><input type="number" value={pay.other} onChange={(e) => setPay((p) => ({ ...p, other: e.target.value }))} /></div>
                <div><label>Mode</label><select value={pay.mode} onChange={(e) => setPay((p) => ({ ...p, mode: e.target.value }))}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
                <div><label>UTR / cheque no.</label><input value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} /></div>
                <div><label>Deduction note</label><input value={pay.otherNote} onChange={(e) => setPay((p) => ({ ...p, otherNote: e.target.value }))} placeholder="e.g. short-payment, damage" /></div>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button disabled={busy} onClick={submitPay}>{busy ? 'Saving…' : 'Save payment'}</button>
                <button className="secondary" onClick={() => setPaying(null)}>Cancel</button>
              </div>
            </div>
          )}

          <h3 style={{ marginTop: 16 }}>Ledger</h3>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Amount</th><th>Balance</th></tr></thead>
            <tbody>
              {stmt.ledger.map((l: any) => (
                <tr key={l.id}>
                  <td className="muted" style={{ fontSize: 12 }}>{String(l.createdAt).slice(0, 10)}</td>
                  <td>{l.entryType.replace(/_/g, ' ')}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{l.reference || '—'}</td>
                  <td style={{ color: Number(l.amount) < 0 ? 'green' : 'inherit' }}>{inr(l.amount)}</td>
                  <td>{inr(l.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
