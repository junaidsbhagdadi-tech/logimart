import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, Invoice } from '../api';
import { useAuth } from '../auth';

export function InvoiceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const isFinance = user?.role === 'FINANCE_EXEC' || user?.role === 'SYS_ADMIN';
  const canDispute = isFinance || user?.role === 'CLIENT_ADMIN';
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [sp] = useSearchParams();
  const [dateOpen, setDateOpen] = useState(sp.get('edit') === '1');
  const [df, setDf] = useState({ invoiceDate: '', periodStart: '', periodEnd: '' });
  useEffect(() => {
    if (inv) setDf({ invoiceDate: String(inv.issuedAt ?? '').slice(0, 10), periodStart: inv.periodStart.slice(0, 10), periodEnd: inv.periodEnd.slice(0, 10) });
  }, [inv]);
  const saveDates = async () => {
    try { await api.setInvoiceDates(id!, df); setDateOpen(false); setError(''); load(); } catch (e: any) { setError(e.message); }
  };

  // Bill working sheet (per-AWB charge breakup as billed on this invoice) — for the customer too.
  const worksheet = async () => {
    if (!inv) return;
    const XLSX = await import('xlsx');
    const rank = (k: string) => (k === 'freight' ? 0 : k === 'fuel' ? 1 : 2);
    const heads = Array.from(new Set(inv.lines.flatMap((l: any) => Object.keys(l.breakup ?? {}).filter((k) => typeof (l.breakup as any)[k] === 'number'))))
      .filter((k) => !['subtotal', 'total', 'chargeableKg', 'gst', 'tax'].includes(k))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const rows = inv.lines.map((l: any, i: number) => {
      const s = l.shipment ?? {};
      const r: Record<string, any> = {
        'Sl': i + 1, 'AWB No': s.awb ?? '', 'Booking date': s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-GB') : '',
        'Reference': s.referenceNo ?? '', 'Consignee': s.consigneeName ?? '', 'Destination': s.destName ?? s.consigneeCity ?? '', 'Pincode': s.destPincode ?? '',
        'Product': s.product ?? '', 'Pieces': s.pieceCount ?? '', 'Actual kg': s.totalDeadKg != null ? Number(s.totalDeadKg) : '', 'Chargeable kg': Number(l.chargeableKg),
      };
      if (heads.length) for (const h of heads) r[h.toUpperCase()] = Number((l.breakup as any)?.[h] ?? 0);
      else { r['FREIGHT'] = Number(l.freight ?? 0); r['FUEL'] = Number(l.fuel ?? 0); r['OTHER'] = Number(l.otherCharges ?? 0); }
      r['Total (ex-GST)'] = Number(l.amount);
      return r;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Bill working');
    XLSX.writeFile(wb, `Bill-working-${inv.invoiceNo}.xlsx`);
  };

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
          <button className="secondary" onClick={worksheet} title="Per-AWB charge breakup of this invoice (Excel)">⬇ Bill worksheet</button>
          <a href={`/invoices/${id}/print`} target="_blank" rel="noreferrer"><button>⬇ Download / Print</button></a>
        </div>
      </div>

      {dateOpen && isFinance && inv.status === 'DRAFT' && (
        <div className="card" style={{ borderLeft: '4px solid var(--navy)' }}>
          <h2>Edit invoice dates</h2>
          <div className="grid cols-3">
            <div><label>Invoice date</label><input type="date" value={df.invoiceDate} onChange={(e) => setDf({ ...df, invoiceDate: e.target.value })} /></div>
            <div><label>From invoice date</label><input type="date" value={df.periodStart} onChange={(e) => setDf({ ...df, periodStart: e.target.value })} /></div>
            <div><label>To invoice date</label><input type="date" value={df.periodEnd} onChange={(e) => setDf({ ...df, periodEnd: e.target.value })} /></div>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Only while the invoice is unlocked. The invoice date is kept when you lock it; the due date follows the new "to" date. AWBs on the bill don't change — add / remove them below.</p>
          <div className="row"><button onClick={saveDates}>Save dates</button><button className="secondary" onClick={() => setDateOpen(false)}>Cancel</button></div>
        </div>
      )}

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
          <div><label>Invoice date</label>{inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString('en-GB') : '—'}</div>
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
          {isFinance && inv.status === 'DRAFT' && !dateOpen && <button className="secondary" onClick={() => setDateOpen(true)}>✏ Edit dates</button>}
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
