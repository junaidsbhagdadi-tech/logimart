import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, Invoice } from '../api';
import { useAuth } from '../auth';

export function InvoiceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const isFinance = user?.role === 'FINANCE_EXEC' || user?.role === 'SYS_ADMIN';
  const canDispute = isFinance || user?.role === 'CLIENT_ADMIN';
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    if (id) api.getInvoice(id).then(setInv).catch((e) => setError(e.message));
  };
  useEffect(load, [id]);

  const dispute = async (shipmentId: string) => {
    const reason = prompt('Dispute reason (e.g. weight variance):');
    if (!reason) return;
    try {
      await api.disputeLine(id!, Number(shipmentId), reason);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const undispute = async (shipmentId: string) => {
    if (!confirm('Clear the dispute on this line and unlock it?')) return;
    try { await api.undisputeLine(id!, Number(shipmentId)); setError(''); load(); } catch (e: any) { setError(e.message); }
  };

  const einvoice = async () => {
    try {
      await api.generateEInvoice(id!);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  // #8 add/remove AWBs on a DRAFT invoice · #5 lock
  const addAwb = async () => {
    const awb = window.prompt('Add an AWB to this draft invoice:');
    if (!awb || !awb.trim()) return;
    try { await api.addAwbToInvoice(id!, awb.trim()); setError(''); load(); } catch (e: any) { setError(e.message); }
  };
  const removeAwb = async (shipmentId: string) => {
    if (!confirm('Remove this AWB from the draft invoice?')) return;
    try { await api.removeAwbFromInvoice(id!, Number(shipmentId)); setError(''); load(); } catch (e: any) { setError(e.message); }
  };
  const lock = async () => {
    if (!confirm('Lock this invoice? It will be posted to the customer ledger and can no longer be edited.')) return;
    try { await api.lockInvoice(id!); setError(''); load(); } catch (e: any) { setError(e.message); }
  };

  const [payOpen, setPayOpen] = useState(false);
  const [pf, setPf] = useState({ amount: '', tds: '', other: '', otherNote: '' });

  const openPay = () => {
    if (!inv) return;
    setPf({ amount: inv.total, tds: '', other: '', otherNote: '' });
    setPayOpen(true);
  };
  const submitPay = async () => {
    try {
      await api.payInvoice(id!, {
        amount: pf.amount ? +pf.amount : 0,
        tds: pf.tds ? +pf.tds : undefined,
        other: pf.other ? +pf.other : undefined,
        otherNote: pf.otherNote || undefined,
      });
      setPayOpen(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (error) return <div className="error">{error}</div>;
  if (!inv) return <p className="muted">Loading…</p>;

  const settled = (+pf.amount || 0) + (+pf.tds || 0) + (+pf.other || 0);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{inv.invoiceNo}</h1>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className={`badge ${inv.status}`}>{inv.status}</span>
          <a href={`/invoices/${id}/print`} target="_blank" rel="noreferrer"><button>⬇ Download / Print</button></a>
        </div>
      </div>

      {payOpen && (
        <div className="card" style={{ borderLeft: '4px solid var(--navy)' }}>
          <h2>Record payment</h2>
          <div className="grid cols-3">
            <div><label>Cash received ₹</label><input type="number" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} /></div>
            <div><label>TDS deducted ₹</label><input type="number" value={pf.tds} onChange={(e) => setPf({ ...pf, tds: e.target.value })} /></div>
            <div><label>Other deduction ₹</label><input type="number" value={pf.other} onChange={(e) => setPf({ ...pf, other: e.target.value })} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Other deduction note</label><input value={pf.otherNote} onChange={(e) => setPf({ ...pf, otherNote: e.target.value })} placeholder="e.g. rate variance credit" /></div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Settling <strong>₹{settled.toFixed(2)}</strong> of ₹{inv.total}
            {settled >= +inv.total - 0.01 ? ' → invoice will be marked PAID' : ' → PARTIALLY PAID'}
          </p>
          <div className="row">
            <button onClick={submitPay} disabled={settled <= 0}>Confirm</button>
            <button className="secondary" onClick={() => setPayOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="grid cols-3">
          <div><label>Period</label>{inv.periodStart.slice(0, 10)} → {inv.periodEnd.slice(0, 10)}</div>
          <div><label>Due date</label>{inv.dueDate.slice(0, 10)}</div>
          <div><label>Subtotal</label>₹{inv.subtotal}</div>
          <div><label>Tax (GST)</label>₹{inv.tax}</div>
          <div><label>Total</label><strong>₹{inv.total}</strong></div>
          <div><label>GST e-invoice (IRN)</label>{inv.irn ? <span className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>{inv.irn}</span> : '—'}</div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {isFinance && inv.status !== 'PAID' && <button onClick={openPay}>Record payment</button>}
          {isFinance && !inv.irn && <button className="secondary" onClick={einvoice}>Generate e-invoice (IRN)</button>}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Line items</h2>
          {isFinance && inv.status === 'DRAFT' && (
            <div className="row" style={{ gap: 8 }}>
              <span className="badge DRAFT" title="Editable until locked">DRAFT — editable</span>
              <button className="secondary" onClick={addAwb}>＋ Add AWB</button>
              <button onClick={lock} disabled={!inv.lines.length}>🔒 Lock invoice</button>
            </div>
          )}
        </div>
        <p className="muted">{inv.status === 'DRAFT' ? 'Add or remove AWBs, then Lock to post this invoice to the ledger.' : 'Disputed lines are locked; clean lines remain payable.'}</p>
        <table>
          <thead>
            <tr><th>Shipment</th><th>Chargeable kg</th><th>Amount</th><th>State</th><th></th></tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{(l as any).shipment?.awb
                  ? <a href={`/shipments/${(l as any).shipment.awb}`} target="_blank" rel="noreferrer"><strong>{(l as any).shipment.awb}</strong></a>
                  : `#${l.shipmentId}`}</td>
                <td>{l.chargeableKg}</td>
                <td>₹{l.amount}</td>
                <td>
                  {l.isDisputed ? (
                    <span className="badge PARTIAL" title={l.disputeReason || ''}>DISPUTED / LOCKED</span>
                  ) : (
                    <span className="badge DELIVERED">OPEN</span>
                  )}
                  {l.disputeReason && (
                    <div className="muted" style={{ fontSize: 11 }}>{l.disputeReason}</div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {isFinance && inv.status === 'DRAFT' ? (
                    <button className="secondary" style={{ color: 'var(--danger, #c0392b)' }} title="Remove this AWB from the invoice" onClick={() => removeAwb(l.shipmentId)}>✕ Remove</button>
                  ) : l.isDisputed ? (
                    canDispute && <button className="secondary" onClick={() => undispute(l.shipmentId)} title="Clear the dispute and unlock this line">↩ Clear dispute</button>
                  ) : canDispute ? (
                    <button className="secondary" onClick={() => dispute(l.shipmentId)}>Dispute</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
