import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, Invoice } from '../api';
import { COMPANY } from '../company';
import { Logo } from '../components/Logo';

/** Indian-system number to words (rupees). */
function rupeesInWords(n: number): string {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number): string => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
  const three = (x: number): string => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
  let num = Math.floor(n);
  if (num === 0) return 'Zero';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const parts = [
    crore ? `${three(crore)} Crore` : '',
    lakh ? `${three(lakh)} Lakh` : '',
    thousand ? `${three(thousand)} Thousand` : '',
    num ? three(num) : '',
  ].filter(Boolean);
  return parts.join(' ');
}

/** Print-ready GST tax invoice. Use the browser's Print → Save as PDF to download. */
export function InvoicePrint() {
  const { id } = useParams();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) api.getInvoice(id).then(setInv).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="error" style={{ margin: 24 }}>{error}</div>;
  if (!inv) return <p className="muted" style={{ margin: 24 }}>Loading…</p>;

  const c = inv.client;
  return (
    <div className="invoice-page">
      <div className="no-print" style={{ marginBottom: 12 }}>
        <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>

      <div className="invoice-doc">
        <div className="inv-head">
          <div>
            <Logo height={54} />
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              {COMPANY.addressLines.join(', ')}<br />
              {COMPANY.phones} · {COMPANY.email}
              {COMPANY.gstin && <><br />GSTIN: {COMPANY.gstin}</>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)' }}>TAX INVOICE</div>
            <div><strong>{inv.invoiceNo}</strong></div>
            <div className="muted" style={{ fontSize: 12 }}>
              Period {inv.periodStart.slice(0, 10)} → {inv.periodEnd.slice(0, 10)}<br />
              Due {inv.dueDate.slice(0, 10)}
            </div>
          </div>
        </div>

        <div className="inv-billto">
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Bill To</div>
          <div style={{ fontWeight: 700 }}>{c?.legalName ?? '—'} {c?.accountCode ? `(${c.accountCode})` : ''}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {[c?.addressLine, c?.city, c?.pincode].filter(Boolean).join(', ') || '—'}
            {c?.gstin && <><br />GSTIN: {c.gstin}</>}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Place of supply: <strong>{inv.placeOfSupply ?? '—'}</strong> · SAC: <strong>{inv.sacCode ?? '9968'}</strong>
          </div>
        </div>

        <table style={{ marginTop: 16 }}>
          <thead>
            <tr><th>#</th><th>Consignment (AWB)</th><th>Lane</th><th style={{ textAlign: 'right' }}>Chargeable kg</th><th style={{ textAlign: 'right' }}>Amount (₹)</th></tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>{l.shipment?.awb ?? `#${l.shipmentId}`}{l.isDisputed && <span className="badge DISPUTED" style={{ marginLeft: 6 }}>DISPUTED</span>}</td>
                <td>{l.shipment ? `${l.shipment.originZone}→${l.shipment.destZone}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{l.chargeableKg}</td>
                <td style={{ textAlign: 'right' }}>{l.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="inv-totals">
          <div><span>Taxable value</span><span>₹{inv.subtotal}</span></div>
          {Number(inv.igst ?? 0) > 0 ? (
            <div><span>IGST 18%</span><span>₹{inv.igst}</span></div>
          ) : (
            <>
              <div><span>CGST 9%</span><span>₹{inv.cgst ?? inv.tax}</span></div>
              <div><span>SGST 9%</span><span>₹{inv.sgst ?? 0}</span></div>
            </>
          )}
          <div className="grand"><span>Total</span><span>₹{inv.total}</span></div>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          <strong>Amount in words:</strong> Rupees {rupeesInWords(Number(inv.total))} only
        </div>

        {inv.irn && (
          <div className="muted" style={{ marginTop: 16, fontSize: 11, wordBreak: 'break-all' }}>
            GST e-invoice IRN: {inv.irn}
          </div>
        )}
        <div className="muted" style={{ marginTop: 24, fontSize: 11 }}>
          This is a computer-generated tax invoice. {COMPANY.legalName}.
        </div>
      </div>
    </div>
  );
}
