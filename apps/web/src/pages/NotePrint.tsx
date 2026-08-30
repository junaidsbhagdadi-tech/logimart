import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { COMPANY } from '../company';

const inr = (n: any) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ddmmyyyy = (s?: string | null) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

/** Indian-system rupees to words. */
function rupeesInWords(n: number): string {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number): string => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
  const three = (x: number): string => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
  let num = Math.floor(n); if (num === 0) return 'Zero';
  const cr = Math.floor(num / 10000000); num %= 10000000;
  const la = Math.floor(num / 100000); num %= 100000;
  const th = Math.floor(num / 1000); num %= 1000;
  return [cr ? `${three(cr)} Crore` : '', la ? `${three(la)} Lakh` : '', th ? `${three(th)} Thousand` : '', num ? three(num) : ''].filter(Boolean).join(' ');
}

/** Print-ready Debit / Credit Note with an authorised-signatory + stamp block. */
export function NotePrint() {
  const { id } = useParams();
  const [n, setN] = useState<any | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (id) api.getNote(id).then(setN).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div className="error" style={{ margin: 24 }}>{error}</div>;
  if (!n) return <p className="muted" style={{ margin: 24 }}>Loading…</p>;

  const isDebit = n.kind === 'DEBIT';
  const title = isDebit ? 'DEBIT NOTE' : 'CREDIT NOTE';
  const c = n.client || {};
  const paise = Math.round((Number(n.total) % 1) * 100);

  return (
    <div style={{ background: '#f0f2f4', minHeight: '100vh', padding: 16 }}>
      <style>{`@media print { .no-print{display:none!important} .doc{box-shadow:none!important;border:none!important} @page{size:A4;margin:12mm} }`}</style>
      <div className="no-print" style={{ maxWidth: 820, margin: '0 auto 12px' }}>
        <button onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>
      <div className="doc" style={{ maxWidth: 820, margin: '0 auto', background: '#fff', color: '#111', padding: 28, borderRadius: 6, boxShadow: '0 8px 30px -18px rgba(0,0,0,.4)', fontSize: 13 }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #111', paddingBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{COMPANY.legalName}</div>
            <div style={{ fontSize: 11, color: '#444' }}>{COMPANY.addressLines.join(' ')}</div>
            <div style={{ fontSize: 11, color: '#444' }}>GSTIN: {COMPANY.gstin} · PAN: {COMPANY.pan} · {COMPANY.phones}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 1, color: isDebit ? '#a4291e' : '#0f7a43' }}>{title}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}><strong>{n.noteNo}</strong></div>
            <div style={{ fontSize: 11, color: '#444' }}>Date: {ddmmyyyy(n.createdAt)}</div>
            {n.status === 'cancelled' && <div style={{ color: '#a4291e', fontWeight: 700 }}>CANCELLED</div>}
          </div>
        </div>

        {/* bill to */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#777' }}>{isDebit ? 'Debit to' : 'Credit to'}</div>
            <div style={{ fontWeight: 700 }}>{c.legalName || '—'}</div>
            <div style={{ fontSize: 11, color: '#444' }}>{[c.addressLine, c.city, c.state, c.pincode].filter(Boolean).join(', ')}</div>
            <div style={{ fontSize: 11, color: '#444' }}>{c.gstin ? `GSTIN: ${c.gstin}` : ''}{c.accountCode ? ` · A/c: ${c.accountCode}` : ''}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: '#444' }}>
            {n.shipment?.awb && <div>Ref AWB: <strong>{n.shipment.awb}</strong></div>}
            <div>Reason: {String(n.reason || '').replace(/_/g, ' ')}</div>
            <div>Place of supply: {COMPANY.jurisdiction}</div>
          </div>
        </div>

        {/* narration + amounts */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16, fontSize: 12.5 }}>
          <thead><tr style={{ background: '#f3f4f6' }}><th style={{ textAlign: 'left', padding: '8px 10px', border: '1px solid #ddd' }}>Particulars</th><th style={{ textAlign: 'right', padding: '8px 10px', border: '1px solid #ddd', width: 140 }}>Amount (₹)</th></tr></thead>
          <tbody>
            <tr><td style={{ padding: '10px', border: '1px solid #ddd' }}>{n.narration || (isDebit ? 'Debit note' : 'Credit note') + ' — ' + String(n.reason || '').replace(/_/g, ' ')}</td><td style={{ textAlign: 'right', padding: '10px', border: '1px solid #ddd' }}>{inr(n.subtotal)}</td></tr>
            {Number(n.cgst) > 0 && <tr><td style={{ padding: '6px 10px', border: '1px solid #ddd', textAlign: 'right' }}>CGST 9%</td><td style={{ textAlign: 'right', padding: '6px 10px', border: '1px solid #ddd' }}>{inr(n.cgst)}</td></tr>}
            {Number(n.sgst) > 0 && <tr><td style={{ padding: '6px 10px', border: '1px solid #ddd', textAlign: 'right' }}>SGST 9%</td><td style={{ textAlign: 'right', padding: '6px 10px', border: '1px solid #ddd' }}>{inr(n.sgst)}</td></tr>}
            {Number(n.igst) > 0 && <tr><td style={{ padding: '6px 10px', border: '1px solid #ddd', textAlign: 'right' }}>IGST 18%</td><td style={{ textAlign: 'right', padding: '6px 10px', border: '1px solid #ddd' }}>{inr(n.igst)}</td></tr>}
            <tr style={{ background: '#f3f4f6', fontWeight: 800 }}><td style={{ padding: '8px 10px', border: '1px solid #ddd', textAlign: 'right' }}>Total</td><td style={{ textAlign: 'right', padding: '8px 10px', border: '1px solid #ddd' }}>₹ {inr(n.total)}</td></tr>
          </tbody>
        </table>
        <div style={{ fontSize: 11.5, marginTop: 8, fontStyle: 'italic', color: '#333' }}>
          Rupees {rupeesInWords(Number(n.total))}{paise ? ` and ${paise}/100` : ''} only.
        </div>

        {/* signatory + stamp */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 44 }}>
          <div style={{ fontSize: 10.5, color: '#666', maxWidth: 360 }}>
            This is a computer-generated {isDebit ? 'debit' : 'credit'} note. {isDebit ? 'Amount is added to the account and payable per the invoice terms.' : 'Amount is adjusted against the account.'}
          </div>
          <div style={{ textAlign: 'center', minWidth: 220 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>For {COMPANY.legalName}</div>
            <div style={{ position: 'relative', height: 78, margin: '2px 0' }}>
              {/* Drop /company-stamp.png and /authorised-sign.png into apps/web/public to show them here. */}
              <img src="/company-stamp.png" alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} style={{ position: 'absolute', left: 0, top: 0, height: 76, opacity: 0.9 }} />
              <img src="/authorised-sign.png" alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} style={{ position: 'absolute', right: 10, top: 14, height: 48 }} />
            </div>
            <div style={{ borderTop: '1px solid #111', paddingTop: 4, fontSize: 11.5 }}>Authorised Signatory (Sign &amp; Stamp)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
