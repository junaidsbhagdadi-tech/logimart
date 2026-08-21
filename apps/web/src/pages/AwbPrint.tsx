import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Barcode } from '../components/Barcode';

const rup = (v: any) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const d10 = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '');

/** Physical consignment note / AWB print, per product format:
 *  DP → ExcelEx Express · APEX → Blue Dart Apex · SURFACE → Blue Dart Surfaceline.
 *  Prints at booking, travels with the shipment, and its Receiver's Details = the POD. */
export function AwbPrint() {
  const { awb } = useParams();
  const [s, setS] = useState<any>(null);
  const [q, setQ] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!awb) return;
    api.getShipment(awb).then(setS).catch((e) => setErr(e.message));
    api.rateQuote(awb).then(setQ).catch(() => setQ(null));
  }, [awb]);

  if (err) return <div style={{ padding: 24 }} className="error">{err}</div>;
  if (!s) return <div style={{ padding: 24 }}>Loading {awb}…</div>;

  const product = String(s.product || '').toUpperCase();
  const fmt = product === 'APEX' ? 'APEX' : product === 'SURFACE' ? 'SURFACE' : 'DP';

  return (
    <div className="awb-print">
      <style>{PRINT_CSS}</style>
      <div className="toolbar no-print">
        <span>AWB <b>{s.awb}</b> · {fmt} format</span>
        <div>
          <button onClick={() => window.print()}>🖨 Print</button>
          <button className="secondary" onClick={() => window.history.back()}>Back</button>
        </div>
      </div>
      {fmt === 'DP' ? <ExcelExNote s={s} q={q} /> : <CargoNote s={s} q={q} surface={fmt === 'SURFACE'} />}
    </div>
  );
}

/** charge amount from the quote (typed fields + line lookup). */
function charge(q: any, key: string): string {
  if (!q) return '';
  const direct: Record<string, number> = { freight: q.freight, fuel: q.fuel, fov: q.fov, oda: q.oda, docket: q.docket, handling: q.handling };
  if (key in direct) return direct[key] ? rup(direct[key]) : '';
  const l = (q.lines || []).find((x: any) => new RegExp(key, 'i').test(x.head));
  return l ? rup(l.amount) : '';
}

// ============================ ExcelEx Express (DP) ============================
function ExcelExNote({ s, q }: { s: any; q: any }) {
  const gst = q?.gst || 0;
  return (
    <div className="note excelex">
      <table className="frame"><tbody>
        <tr>
          <td className="brand" style={{ width: '46%' }}>
            <div className="logo">◭ ExcelEx Express Logistics LLP</div>
            <div className="sub">Domestic &amp; International Courier &amp; Cargo</div>
            <div className="tiny">GST NO - 07AAIFE6185E1ZC · www.excelexlog.com</div>
          </td>
          <td style={{ textAlign: 'center' }}><Barcode value={s.awb} /><div className="awbno">AWB NO. {s.awb}</div></td>
          <td style={{ width: '22%', fontSize: 10 }}>
            <div className="chk">INTERNATIONAL &nbsp; DOX ☐ NON-DOX ☐</div>
            <div className="chk">DOMESTIC &nbsp; DOX {s.docType === 'DOX' ? '☑' : '☐'} NON-DOX {s.docType !== 'DOX' ? '☑' : '☐'}</div>
            <div className="chk" style={{ marginTop: 4 }}>MODE: AIR ☐ TRAIN ☐ ROAD ☐</div>
          </td>
        </tr>
      </tbody></table>

      <table className="frame grid"><tbody>
        <tr>
          <td style={{ width: '50%' }} className="party">
            <div className="ph">ORIGIN: {s.originZone || ''}</div>
            <div className="ph"><b>SHIPPER</b></div>
            <div>{shipperName(s)}</div>
            <div>{s.shipperAddress1 || ''} {s.shipperAddress2 || ''}</div>
            <div>PINCODE: {s.shipperPincode || ''} &nbsp; MOBILE: {s.shipperMobile || s.shipperPhone || ''}</div>
            <div>GSTIN: {s.shipperGstin || s.consignorGstin || ''}</div>
          </td>
          <td style={{ width: '50%' }} className="party">
            <div className="ph">DESTINATION: {s.destZone || ''} &nbsp; ONFWD NO: {s.bdWaybill || ''}</div>
            <div className="ph"><b>CONSIGNEE</b></div>
            <div>{s.consigneeName || ''}</div>
            <div>{s.consigneeAddress || ''} {s.consigneeCity || ''}</div>
            <div>PINCODE: {s.destPincode || ''} &nbsp; MOBILE: {s.consigneePhone || ''}</div>
            <div>GSTIN: {s.consigneeGstin || ''}</div>
          </td>
        </tr>
      </tbody></table>

      <table className="frame charges"><tbody>
        <tr>
          <td style={{ width: '64%', verticalAlign: 'top' }}>
            <table className="inner"><tbody>
              <tr><th>NO. OF PCS</th><th>VALUE OF CONSIGNMENT</th><th>CONTENTS — DESCRIPTION</th><th>DIMENSIONS (Cms)</th><th>ACTUAL WT</th></tr>
              <tr>
                <td>{s.pieceCount}</td><td>{rup(s.shipmentValue || s.declaredValue)}</td><td>{s.goodsDesc || ''}</td>
                <td>{(s.pieces || []).slice(0, 4).map((p: any, i: number) => <div key={i}>{p.lengthCm || '-'}×{p.widthCm || '-'}×{p.heightCm || '-'}</div>)}</td>
                <td>{s.chargeWeight || s.totalDeadKg} Kg</td>
              </tr>
            </tbody></table>
            <div className="strip">DATE: {d10(s.createdAt)} &nbsp;&nbsp; Invoice No: {s.referenceNo || ''}</div>
            <div className="strip">NATURE: {s.isCommercial ? 'COMMERCIAL' : 'NON-COMMERCIAL'} &nbsp;&nbsp; {s.paymentTerm === 'TO_PAY' ? '☑ TO-PAY' : '☑ CASH/CREDIT'}</div>
            <div className="receiver">
              <b>Receiver's Details (POD)</b>
              <div>NAME: _______________________ &nbsp; DATE: __________</div>
              <div>STAMP &amp; SIGNATURE: _____________________________</div>
            </div>
          </td>
          <td style={{ width: '36%', verticalAlign: 'top' }}>
            <table className="amt"><tbody>
              <tr><td>Freight Charge</td><td>{charge(q, 'freight')}</td></tr>
              <tr><td>Service Charge</td><td></td></tr>
              <tr><td>Insurance Charge</td><td>{charge(q, 'fov')}</td></tr>
              <tr><td>Fuel Surcharge</td><td>{charge(q, 'fuel')}</td></tr>
              <tr className="b"><td>SUB-TOTAL</td><td>{q ? rup(q.freight + q.fuel + q.fov) : ''}</td></tr>
              <tr><td>Other Charges</td><td>{q ? rup(q.oda + q.docket + q.handling) : ''}</td></tr>
              <tr className="b"><td>TOTAL</td><td>{q ? rup(q.subtotal) : ''}</td></tr>
              <tr><td>SGST</td><td>{rup(gst / 2)}</td></tr>
              <tr><td>CGST</td><td>{rup(gst / 2)}</td></tr>
              <tr><td>IGST</td><td></td></tr>
              <tr className="b grand"><td>GRAND TOTAL</td><td>{q ? rup(q.grandTotal) : ''}</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody></table>
      <div className="foot">Corp. Add.: Seq No MHP 2494 H. No 27/2, Gali No 2, Block A, Mahipalpur Extn, New Delhi 110037 · +011-71859599 · Non-negotiable consignment note · <b>SHIPPER COPY</b></div>
    </div>
  );
}

const shipperName = (s: any) => s.shipperName || s.client?.legalName || '';

// ============ ExcelEx Air Cargo (APEX) / Surface Cargo (SURFACE) ============
function CargoNote({ s, q, surface }: { s: any; q: any; surface: boolean }) {
  const rows = surface
    ? ['Freight', 'RAS Charge', 'Fuel Surcharge', 'AWB Fee', 'FOV Charge', 'Ins. Arrangement', 'VCHC Charge', 'DC Charge', 'ODA Charge', 'Other Charge']
    : ['Freight', 'RAS Charges', 'Fuel Surcharge', 'AWB Fee', 'FOV Charges', 'VCHC Charges', 'DC Charges', 'ODA Charges', 'Other Charges'];
  const amt = (label: string): string => {
    const L = label.toLowerCase();
    if (L.startsWith('freight')) return charge(q, 'freight');
    if (L.startsWith('fuel')) return charge(q, 'fuel');
    if (L.startsWith('fov')) return charge(q, 'fov');
    if (L.startsWith('awb')) return charge(q, 'Airwaybill');
    if (L.startsWith('dc')) return charge(q, 'docket');
    if (L.startsWith('oda')) return charge(q, 'oda') || charge(q, 'EDL');
    if (L.startsWith('other')) return charge(q, 'handling');
    return '';
  };
  return (
    <div className="note excelex cargo">
      <table className="frame"><tbody>
        <tr>
          <td style={{ width: '58%' }}>
            <div className="logo">◭ ExcelEx Express Logistics LLP</div>
            <div className="sub">{surface ? 'Surface Cargo' : 'Air Cargo'} · Product {s.product}</div>
            <div className="tiny">GST NO - 07AAIFE6185E1ZC · www.excelexlog.com</div>
          </td>
          <td style={{ textAlign: 'right', fontSize: 10 }}>
            <div className="tiny">Origin: {s.originZone} &nbsp; Dst: {s.destZone} &nbsp; Wt: {s.chargeWeight || s.totalDeadKg}kg</div>
            <div className="awbno" style={{ fontSize: 13 }}>AWB {s.awb}</div>
          </td>
        </tr>
      </tbody></table>

      <table className="frame charges"><tbody>
        <tr>
          <td style={{ width: '64%', verticalAlign: 'top' }}>
            <table className="grid inner"><tbody>
              <tr>
                <td className="party" style={{ width: '50%' }}>
                  <div className="ph"><b>SHIPPER</b></div>
                  <div>Customer Code: {s.client?.accountCode || ''}</div>
                  <div>{shipperName(s)}</div>
                  <div>{s.shipperAddress1 || ''} {s.shipperAddress2 || ''}</div>
                  <div>City: {s.shipperCity || ''} &nbsp; Pin: {s.shipperPincode || ''}</div>
                  <div>Mob: {s.shipperMobile || s.shipperPhone || ''}</div>
                  <div>GSTIN: {s.shipperGstin || s.consignorGstin || ''}</div>
                </td>
                <td className="party" style={{ width: '50%' }}>
                  <div className="ph"><b>CONSIGNEE</b></div>
                  <div>{s.consigneeName || ''}</div>
                  <div>{s.consigneeAddress || ''}</div>
                  <div>City: {s.consigneeCity || ''} &nbsp; Pin: {s.destPincode || ''}</div>
                  <div>Mob: {s.consigneePhone || ''}</div>
                  <div>GSTIN: {s.consigneeGstin || ''}</div>
                </td>
              </tr>
            </tbody></table>
            <div className="strip">P/U Date: {d10(s.createdAt)} &nbsp; Pcs: {s.pieceCount} &nbsp; Decl. Value: {rup(s.declaredValue || s.shipmentValue)}</div>
            <div className="strip">Description: {s.goodsDesc || ''} &nbsp; Ref: {s.referenceNo || ''}</div>
            <div style={{ textAlign: 'center', margin: '6px 0' }}><Barcode value={s.awb} /><div className="awbno">{s.awb}</div></div>
            <div className="strip">Transaction Type: {s.paymentTerm === 'TO_PAY' ? 'To-Pay' : 'Cash / Credit'} &nbsp; {surface ? 'ODA ☐  SUB PRODUCT CODE ____' : 'EDL ☐  PACK TYPE ____'}</div>
            <div className="receiver">
              <b>Receiver's Details (POD)</b>
              <div>Name: ___________________ Sign: ___________ Date: ________</div>
            </div>
          </td>
          <td style={{ width: '36%', verticalAlign: 'top' }}>
            <table className="amt"><tbody>
              <tr><th colSpan={2}>Details &nbsp; — &nbsp; Amount (Rs.)</th></tr>
              {rows.map((r) => <tr key={r}><td>{r}</td><td>{amt(r)}</td></tr>)}
              <tr className="b"><td>TOTAL</td><td>{q ? rup(q.subtotal) : ''}</td></tr>
              <tr><td>GST</td><td>{q ? rup(q.gst) : ''}</td></tr>
              <tr className="b grand"><td>GRAND TOTAL</td><td>{q ? rup(q.grandTotal) : ''}</td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody></table>
      <div className="foot">Corp. Add.: MHP 2494 H. No 27/2, Gali No 2, Block A, Mahipalpur Extn, New Delhi 110037 · www.excelexlog.com · NON-NEGOTIABLE — AT OWNER'S RISK · <b>SHIPPER'S COPY</b></div>
    </div>
  );
}

const PRINT_CSS = `
.awb-print { background:#fff; color:#111; padding:12px; }
.awb-print .toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.awb-print .toolbar button { margin-left:8px; }
.note { width: 900px; max-width:100%; margin:0 auto; font-family: Arial, sans-serif; font-size:11px; }
.note table.frame { width:100%; border-collapse:collapse; }
.note .frame td { border:1px solid #333; padding:5px 7px; vertical-align:top; }
.note table.grid td { border:1px solid #333; }
.note .party .ph { color:#555; font-size:9.5px; }
.note .party div { line-height:1.5; }
.note .logo { font-weight:800; font-size:15px; }
.note .sub { font-weight:700; font-size:11px; }
.note .tiny { font-size:9px; color:#444; }
.note .awbno { font-weight:700; letter-spacing:1px; margin-top:2px; }
.note .chk { font-size:9.5px; line-height:1.6; }
.note table.inner { width:100%; border-collapse:collapse; margin-bottom:4px; }
.note table.inner th, .note table.inner td { border:1px solid #333; padding:3px 5px; font-size:10px; text-align:left; }
.note .strip { border:1px solid #333; border-top:none; padding:3px 6px; font-size:10px; }
.note .receiver { border:1px solid #333; border-top:none; padding:6px; margin-top:0; line-height:1.9; }
.note table.amt { width:100%; border-collapse:collapse; }
.note table.amt td, .note table.amt th { border:1px solid #333; padding:3px 6px; }
.note table.amt td:last-child, .note table.amt th:last-child { text-align:right; width:42%; }
.note table.amt tr.b td { font-weight:800; }
.note table.amt tr.grand td { font-size:13px; background:#f0f0f0; }
.note .foot { font-size:8.5px; color:#333; margin-top:6px; text-align:center; }
.note.excelex .logo, .note.excelex .sub, .note.excelex .party .ph b { color:#12459c; }
/* Cargo (APEX / SURFACE) prints larger for readability */
.note.cargo { width: 1060px; font-size: 13px; }
.note.cargo .frame td { padding: 8px 11px; }
.note.cargo .party div { line-height: 1.75; }
.note.cargo .logo { font-size: 18px; }
.note.cargo .sub { font-size: 13px; }
.note.cargo .awbno { font-size: 16px; }
.note.cargo .strip { padding:5px 9px; font-size:12px; }
.note.cargo .receiver { padding:12px; line-height:2.4; font-size:12.5px; }
.note.cargo table.amt td, .note.cargo table.amt th { padding:6px 10px; font-size:12.5px; }
.note.cargo table.grid td { padding:6px 9px; }
@media print {
  .note.cargo { width:100%; font-size:12.5px; }
  .no-print { display:none !important; }
  .awb-print { padding:0; }
  .note { width:100%; }
  @page { size: A4 landscape; margin: 8mm; }
}
`;
