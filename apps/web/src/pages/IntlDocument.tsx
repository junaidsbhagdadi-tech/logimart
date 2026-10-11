import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';

/** Printable commercial invoice + packing summary for an international job. */
export function IntlDocument() {
  const { idOrJob } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.intlDocument(idOrJob!).then(setD).catch((e) => setErr(e.message)); }, [idOrJob]);
  if (err) return <div className="error" style={{ margin: 20 }}>{err}</div>;
  if (!d) return <div style={{ margin: 20 }}>Loading…</div>;

  const dt = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—');
  const money = (n: any) => `${d.currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  const box: React.CSSProperties = { border: '1px solid #333', padding: 8, fontSize: 12 };
  const th: React.CSSProperties = { border: '1px solid #333', padding: '4px 6px', fontSize: 11, textAlign: 'left', background: '#f0f0f0' };
  const td: React.CSSProperties = { border: '1px solid #333', padding: '4px 6px', fontSize: 11 };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 24, color: '#111', background: '#fff' }}>
      <div className="no-print" style={{ marginBottom: 12 }}>
        <button onClick={() => window.print()}>🖨 Print</button>
      </div>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>COMMERCIAL INVOICE</div>
        <div style={{ fontSize: 12 }}>ExcelEx Express Logistics LLP · International {String(d.mode).replace('_', ' ')}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        <div style={box}><b>Shipper / Exporter</b><br />{d.shipperName || d.client?.legalName || '—'}<br />{d.shipperAddress}<br />{[d.shipperCity, d.shipperCountry].filter(Boolean).join(', ')}<br />{d.shipperContact}</div>
        <div style={box}><b>Consignee</b><br />{d.consigneeName || '—'}<br />{d.consigneeAddress}<br />{[d.consigneeCity, d.consigneeCountry].filter(Boolean).join(', ')}<br />{d.consigneeContact}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
        <div style={box}><b>Job No.</b><br />{d.jobNo}</div>
        <div style={box}><b>Date</b><br />{dt(d.bookedAt || d.createdAt)}</div>
        <div style={box}><b>Incoterm</b><br />{d.incoterm || '—'}</div>
        <div style={box}><b>Origin</b><br />{[d.originPort, d.originCountry].filter(Boolean).join(', ') || '—'}</div>
        <div style={box}><b>Destination</b><br />{[d.destPort, d.destCountry].filter(Boolean).join(', ') || '—'}</div>
        <div style={box}><b>{d.mode?.startsWith('OCEAN') ? 'MBL / HBL' : 'MAWB / HAWB'}</b><br />{(d.masterNo || '—')} / {(d.houseNo || '—')}</div>
        <div style={box}><b>Carrier</b><br />{d.carrier || '—'}</div>
        <div style={box}><b>Vessel/Voyage</b><br />{d.vesselVoyage || '—'}{d.containerNo ? ` · ${d.containerNo} ${d.containerType || ''}` : ''}</div>
        <div style={box}><b>HS Code</b><br />{d.hsCode || '—'}</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <thead><tr><th style={th}>#</th><th style={th}>Description of goods</th><th style={th}>Pcs</th><th style={th}>Dims (cm)</th><th style={th}>Weight (kg)</th></tr></thead>
        <tbody>
          {(d.pieces?.length ? d.pieces : [{ count: d.packages, weightKg: d.grossWeightKg, description: d.goodsDesc }]).map((p: any, i: number) => (
            <tr key={i}><td style={td}>{i + 1}</td><td style={td}>{p.description || d.goodsDesc || '—'}</td><td style={td}>{p.count}</td><td style={td}>{[p.lengthCm, p.widthCm, p.heightCm].filter((x: any) => x != null).join('×') || '—'}</td><td style={td}>{p.weightKg ?? '—'}</td></tr>
          ))}
          <tr><td style={td} colSpan={2}><b>Totals</b></td><td style={td}><b>{d.packages}</b></td><td style={td}>—</td><td style={td}><b>{d.grossWeightKg} kg</b>{d.chargeableWeightKg ? ` (chg ${d.chargeableWeightKg})` : ''}{d.volumeCbm ? ` · ${d.volumeCbm} CBM` : ''}</td></tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <thead><tr><th style={th}>Charge</th><th style={{ ...th, textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {(d.charges || []).map((c: any) => <tr key={c.id}><td style={td}>{c.name} ({c.code})</td><td style={{ ...td, textAlign: 'right' }}>{c.currency} {Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>)}
          {(!d.charges || d.charges.length === 0) && <tr><td style={td} colSpan={2}>Declared value: {money(d.declaredValue)}</td></tr>}
          <tr><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>TOTAL</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(d.chargesTotal || d.declaredValue)}</td></tr>
        </tbody>
      </table>

      <div style={{ marginTop: 16, fontSize: 11, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>Marks &amp; numbers: {d.marksNumbers || '—'}<br />Declared value for customs: {money(d.declaredValue)}</div>
        <div style={{ textAlign: 'right' }}>For ExcelEx Express Logistics LLP<br /><br />_____________________<br />Authorised signatory</div>
      </div>
    </div>
  );
}
