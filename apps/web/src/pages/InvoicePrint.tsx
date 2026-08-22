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

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ddmmyyyy = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/** Print-ready GST tax invoice (matches the supplied Excelex-style format). */
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
  const num = (v: any) => Number(v ?? 0);

  // Per-line freight (the "Amount" column). Fall back to the all-in amount for
  // legacy invoices generated before the freight/fuel/other split existed.
  const rows = inv.lines.map((l) => {
    const freight = num(l.freight), fuel = num(l.fuel), other = num(l.otherCharges);
    const hasSplit = freight > 0 || fuel > 0 || other > 0;
    return { l, amount: hasSplit ? freight : num(l.amount), fuel, other };
  });
  const sumFreight = rows.reduce((a, r) => a + r.amount, 0);
  const sumFuel = rows.reduce((a, r) => a + r.fuel, 0);
  const sumOther = rows.reduce((a, r) => a + r.other, 0);
  const subtotal = num(inv.subtotal);           // taxable value = freight + fuel + other
  const igst = num(inv.igst), cgst = num(inv.cgst), sgst = num(inv.sgst);
  const total = num(inv.total);

  const clientStateCode = c?.gstin && c.gstin.length >= 2 ? c.gstin.slice(0, 2) : '';

  return (
    <div className="invoice-page" style={{ background: '#fff', color: '#111', padding: 16 }}>
      <style>{`
        @media print { .no-print { display: none !important; } .inv-doc { box-shadow: none !important; border: none !important; } @page { size: A4; margin: 12mm; } }
        .inv-doc { max-width: 900px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; border: 1px solid #333; }
        .inv-doc .b { border: 1px solid #333; }
        .inv-doc table.lines { width: 100%; border-collapse: collapse; }
        .inv-doc table.lines th, .inv-doc table.lines td { border: 1px solid #333; padding: 3px 6px; }
        .inv-doc table.lines th { background: #f0f0f0; text-align: left; font-size: 11px; }
        .inv-doc table.lines td.r, .inv-doc table.lines th.r { text-align: right; }
        .inv-doc .pad { padding: 8px 10px; }
        .inv-doc .k { color: #333; }
        .inv-doc .lbl { font-weight: 700; }
      `}</style>

      <div className="no-print" style={{ maxWidth: 900, margin: '0 auto 12px' }}>
        <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>

      <div className="inv-doc">
        {/* period + title strip */}
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          <div className="pad" style={{ flex: 1, borderRight: '1px solid #333' }}>
            <div><span className="lbl">Invoice From:</span> {ddmmyyyy(inv.periodStart)}</div>
            <div><span className="lbl">Invoice To:</span> {ddmmyyyy(inv.periodEnd)}</div>
          </div>
          <div className="pad" style={{ flex: 1.4, textAlign: 'center', borderRight: '1px solid #333' }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>TAX INVOICE</div>
            <div style={{ fontSize: 10 }}>(ORIGINAL FOR RECIPIENT OF SERVICE)</div>
          </div>
          <div className="pad" style={{ flex: 1 }}>
            <div><span className="lbl">Inv. No.:</span> {inv.invoiceNo}</div>
            <div><span className="lbl">Invoice Date:</span> {ddmmyyyy(inv.issuedAt ?? inv.periodEnd)}</div>
          </div>
        </div>

        {/* Bill-to (customer) + seller (us) */}
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          <div className="pad" style={{ flex: 1, borderRight: '1px solid #333' }}>
            <div className="lbl" style={{ marginBottom: 2 }}>Bill To:</div>
            <div style={{ fontWeight: 700 }}>{c?.legalName ?? '—'}</div>
            <div className="k">{[c?.addressLine, c?.city, c?.pincode].filter(Boolean).join(', ') || '—'}</div>
            {c?.contactPhone && <div className="k">{c.contactPhone}</div>}
            {c?.contactEmail && <div className="k">{c.contactEmail}</div>}
            <div style={{ marginTop: 4 }}><span className="lbl">GST No.:</span> {c?.gstin ?? '—'}{c?.accountCode ? `  ·  A/C Code: ${c.accountCode}` : ''}</div>
            <div><span className="lbl">State:</span> {c?.state ?? c?.city ?? '—'} {clientStateCode && <>· <span className="lbl">State Code:</span> {clientStateCode}</>}</div>
            <div><span className="lbl">Place of Supply:</span> {inv.placeOfSupply ?? c?.state ?? '—'}</div>
          </div>
          <div className="pad" style={{ flex: 1 }}>
            <div style={{ marginBottom: 4 }}><Logo height={34} /></div>
            <div style={{ fontWeight: 700 }}>{COMPANY.legalName}</div>
            <div className="k">{COMPANY.addressLines.join(', ')}</div>
            <div className="k">{COMPANY.phones}{COMPANY.email ? ` · ${COMPANY.email}` : ''}</div>
            {COMPANY.pan && <div><span className="lbl">PAN No.:</span> {COMPANY.pan}</div>}
            <div><span className="lbl">GST No.:</span> {COMPANY.gstin}</div>
            <div><span className="lbl">HSN/SAC:</span> {inv.sacCode ?? COMPANY.sacCode}</div>
          </div>
        </div>

        {/* line items */}
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: 34 }}>SNo</th>
              <th>AWB No.</th>
              <th style={{ width: 90 }}>Date</th>
              <th>Destination</th>
              <th className="r" style={{ width: 70 }}>Weight</th>
              <th className="r" style={{ width: 100 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.l.id}>
                <td>{i + 1}</td>
                <td>{r.l.shipment?.awb ?? `#${r.l.shipmentId}`}{r.l.isDisputed && <span className="badge DISPUTED" style={{ marginLeft: 6 }}>DISPUTED</span>}</td>
                <td>{ddmmyyyy(r.l.shipment?.createdAt)}</td>
                <td>{r.l.shipment?.consigneeCity ?? r.l.shipment?.destZone ?? '—'}</td>
                <td className="r">{num(r.l.chargeableKg).toFixed(3)}</td>
                <td className="r">{inr(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* summary + bank */}
        <div style={{ display: 'flex', borderTop: '1px solid #333' }}>
          <div className="pad" style={{ flex: 1, borderRight: '1px solid #333' }}>
            <div className="lbl" style={{ marginBottom: 4 }}>Our Bank Details</div>
            <div><span className="lbl">Bank Name:</span> {COMPANY.bank.name}</div>
            <div><span className="lbl">A/C No.:</span> {COMPANY.bank.accountNo}</div>
            <div><span className="lbl">NEFT / RTGS (IFSC):</span> {COMPANY.bank.ifsc}</div>
            <div><span className="lbl">Branch:</span> {COMPANY.bank.branch}</div>
            {COMPANY.bank.address && <div className="k">{COMPANY.bank.address}</div>}
          </div>
          <div style={{ flex: 1 }}>
            <table className="lines" style={{ border: 'none' }}>
              <tbody>
                <tr><td className="lbl">Sub Total</td><td className="r">{inr(sumFreight)}</td></tr>
                <tr><td className="lbl">Fuel Surcharge</td><td className="r">{inr(sumFuel)}</td></tr>
                <tr><td className="lbl">Other Charges</td><td className="r">{inr(sumOther)}</td></tr>
                <tr><td className="lbl">Sub Total</td><td className="r">{inr(subtotal)}</td></tr>
                {igst > 0 ? (
                  <tr><td className="lbl">IGST @ 18.00%</td><td className="r">{inr(igst)}</td></tr>
                ) : (
                  <>
                    <tr><td className="lbl">CGST @ 9.00%</td><td className="r">{inr(cgst || num(inv.tax) / 2)}</td></tr>
                    <tr><td className="lbl">SGST @ 9.00%</td><td className="r">{inr(sgst || num(inv.tax) / 2)}</td></tr>
                  </>
                )}
                <tr style={{ background: '#f0f0f0' }}><td className="lbl">Grand Total</td><td className="r lbl">{inr(total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* amount in words */}
        <div className="pad" style={{ borderTop: '1px solid #333' }}>
          <span className="lbl">Amount in Words:</span> Rupees {rupeesInWords(total)} Only
        </div>

        {inv.irn && (
          <div className="pad k" style={{ borderTop: '1px solid #333', fontSize: 10, wordBreak: 'break-all' }}>
            GST e-invoice IRN: {inv.irn}
          </div>
        )}

        {/* terms */}
        <div className="pad" style={{ borderTop: '1px solid #333' }}>
          <div className="lbl" style={{ marginBottom: 4 }}>Terms &amp; Conditions</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6 }}>
            {COMPANY.terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>

        <div className="pad k" style={{ borderTop: '1px solid #333', textAlign: 'center', fontSize: 10 }}>
          E.&amp;O.E · This is a computer-generated invoice and does not require a signature. — {COMPANY.legalName}
        </div>
      </div>
    </div>
  );
}
