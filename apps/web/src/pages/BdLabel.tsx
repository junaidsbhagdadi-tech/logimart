import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, MasterLabel } from '../api';
import { Barcode } from '../components/Barcode';

/**
 * Courier print set (#8, BlueDart-style, every carrier). Each page is 89 × 69 mm:
 *   1. AWB label (MASTER) — goes with the invoice
 *   2. Box details — sizes / weight / box count
 *   3. AWB label — stuck on the invoice
 *   4. POD copy — the carrier keeps it (signature / seal table)
 *   5. AWB label — shipper's copy
 *   6…  one sticker per box, barcode = carrier AWB + "-0001", "-0002", …
 * The CARRIER's AWB is the barcode; our own AWB prints on every page.
 */
const d2 = (n: number) => String(n).padStart(2, '0');
const ddmmyyyy = (v?: string) => { if (!v) return ''; const d = new Date(v); return `${d2(d.getDate())}/${d2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const money = (v?: number | null) => (v != null ? Number(v).toFixed(2) : '');

/** Clean carrier name for the title (vendor codes are account codes like 476954 / DLY12 / XPB). */
function carrierName(m: MasterLabel): string {
  const v = String(m.vendor || '').toUpperCase();
  const n = String(m.vendorName || '').toUpperCase();
  if (m.bdWaybill || /^(BLUE|BDR)/.test(v) || /BLUE ?DART|^BDR/.test(n)) return 'BLUEDART';
  if (/^DLY|DELHIVERY/.test(v) || /DELHIVERY/.test(n)) return 'DELHIVERY';
  if (/^XPB$|^XB$/.test(v) || /XPRESS ?BEES/.test(n)) return 'XPRESSBEES';
  if (/^GATI$/.test(v) || /GATI|ALLCARGO/.test(n)) return 'GATI';
  if (/^VXP$|^VX$/.test(v) || /V ?EXPRESS/.test(n)) return 'V EXPRESS';
  if (/^ARL$/.test(v) || /AR LOG/.test(n)) return 'AR LOGISTICS';
  if (/^DSC$/.test(v) || /DS ?CARGO/.test(n)) return 'DS CARGO';
  if (!v || v === 'SELF') return m.carrier.brand.toUpperCase();
  return (m.vendorName || v).toUpperCase();
}
function serviceName(m: MasterLabel): string {
  const p = String(m.product || '').toUpperCase();
  if (/APEX|APX/.test(p)) return 'APEX';
  if (/AIR/.test(String(m.serviceMode || ''))) return 'AIR';
  return 'SURFACE';
}

export function BdLabel() {
  const { awb } = useParams();
  const [m, setM] = useState<MasterLabel | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (awb) api.getLabels(awb).then((r) => setM(r.master)).catch((e) => setError(e.message));
  }, [awb]);

  if (error) return <div style={{ padding: 24, color: '#b00' }}>{error}</div>;
  if (!m) return <p style={{ padding: 24 }}>Loading…</p>;

  const title = `${carrierName(m)} - ${serviceName(m)}`;
  const isDelhivery = carrierName(m) === 'DELHIVERY';
  const firstBoxId = (m.boxes ?? []).find((b: any) => b.carrierId)?.carrierId as string | undefined;
  // Delhivery's scanners read the master waybill (MAWB = the first box's waybill), not the LR number.
  const lr = isDelhivery && firstBoxId ? (m.forwardingAwb || m.carrierAwb || '') : '';
  const carrierAwb = (isDelhivery && firstBoxId) || m.carrierAwb || m.bdWaybill || m.forwardingAwb || '';
  const lead = carrierAwb || m.awb; // barcode value
  const isOwn = !m.vendor || m.vendor === 'SELF';
  const org = m.bdRouteOrg || [m.originZone, m.originCity].filter(Boolean).join(' / ') || '—';
  const dst = m.bdRouteDst || [m.destZone, m.consigneeCity].filter(Boolean).join(' / ') || '—';
  const kg = Number(m.chargeWeight ?? m.totalDeadKg ?? 0).toFixed(2);
  const boxes: any[] = m.boxes?.length ? m.boxes : Array.from({ length: m.pieceCount || 1 }, () => ({ l: 0, w: 0, h: 0, deadKg: 0 }));
  const dimGroups = new Map<string, number>();
  boxes.forEach((b) => { if (b.l && b.w && b.h) { const k = `${b.l} x ${b.w} x ${b.h}`; dimGroups.set(k, (dimGroups.get(k) || 0) + 1); } });
  const dims = [...dimGroups.entries()].map(([k, n]) => (dimGroups.size > 1 || n > 1 ? `${k} (${n})` : k)).join(', ') || '—';
  // On a carrier's label the sender is our account code only — the carrier must never see our customer's name.
  const sender = isOwn ? `${m.accountCode || ''} - ${m.shipperName || m.consignor.name}` : `LOGIMART ${m.accountCode || ''}`.trim();
  const date = ddmmyyyy(m.createdAt);
  // Page 2 — boxes grouped by identical size, with their weight where each box's weight is known.
  const groupMap = new Map<string, { dims: string; n: number; kg: number }>();
  boxes.forEach((b) => {
    const k = b.l && b.w && b.h ? `${Number(b.l).toFixed(1)} X ${Number(b.w).toFixed(1)} X ${Number(b.h).toFixed(1)}` : '—';
    const g = groupMap.get(k) ?? { dims: k, n: 0, kg: 0 };
    g.n += 1; g.kg += Number(b.deadKg || 0); groupMap.set(k, g);
  });
  const boxGroups = [...groupMap.values()];
  // Our internal AWB goes on every page (the barcode is the carrier's number).
  const ourTag = carrierAwb && !isOwn ? <span className="cl-small"> | Our AWB: {m.awb}</span> : null;

  const label = (copy: string) => (
    <section className="cl" key={copy}>
      <div className="cl-copy">{copy}</div>
      <div className="cl-title">{title}</div>
      <div className="cl-line cl-big">Org: {org} - Dst: {dst}{m.referenceNo ? <span className="cl-small"> | Ref No: {m.referenceNo}</span> : null}</div>
      <div className="cl-line cl-big">Wgt: {kg} KGs | MASTER - {m.pieceCount} Boxes | Date:{date}</div>
      <div className="cl-bar">
        <Barcode value={lead} />
        {carrierAwb && !isOwn && <div className="cl-our">{lr ? <>LR: <b>{lr}</b> · </> : null}Our AWB: <b>{m.awb}</b></div>}
      </div>
      <div className="cl-line">Sender: {sender}</div>
      <div className="cl-line">Inv No: {m.invoiceNo || '—'} | Inv Val: {money(m.shipmentValue) || '—'} INR | Dims: {dims}</div>
      <div className="cl-recv">
        <div>Receiver : {m.consignee.name},</div>
        <div className="cl-addr">{m.consignee.address}</div>
        <div>Pincode : {m.destPincode || '—'} Ph: {m.consigneePhone || m.consignee.phone || '—'}</div>
      </div>
      <div className="cl-line cl-cmdty">Cmdty :{(m.goodsDesc || 'GOODS').toUpperCase()} -</div>
    </section>
  );

  return (
    <div className="cl-page">
      <div className="cl-toolbar no-print">
        <Link to={`/shipments/${m.awb}`}>← {m.awb}</Link>
        <span className="cl-hint">{5 + boxes.length} pages · 89 × 69 mm</span>
        <button onClick={() => window.print()}>🖨 Print</button>
      </div>
      {!carrierAwb && !isOwn && (
        <div className="no-print cl-warn">
          ⚠ <b>No {carrierName(m)} AWB yet.</b> These labels show our AWB ({m.awb}), which the carrier can't scan. Hand the shipment to the carrier first (<Link to={`/shipments/${m.awb}`}>open shipment</Link>), then reprint.
        </div>
      )}

      {label('1 · WITH INVOICE')}

      <section className="cl">
        <div className="cl-copy">2 · BOX DETAILS</div>
        <div className="cl-title">{title}</div>
        <div className="cl-line">AWB: {lead} | DATE: {date} | BOX DETAILS</div>
        <div className="cl-line">INV NO: {m.invoiceNo || '—'} | INV VAL: {money(m.shipmentValue) || '—'} INR</div>
        <table className="cl-pod cl-boxes">
          <thead><tr><th>SL. NO.</th><th>DIMENSIONS (CMS)</th><th>WEIGHT (KGS)</th><th>NO. OF BOXES</th></tr></thead>
          <tbody>
            {boxGroups.map((g, i) => <tr key={g.dims}><td>{i + 1}</td><td>{g.dims}</td><td>{g.kg ? g.kg.toFixed(2) : ''}</td><td>{g.n}</td></tr>)}
            <tr><td /><td><b>TOTAL</b></td><td><b>{kg} KGS</b></td><td><b>{boxes.length}</b></td></tr>
          </tbody>
        </table>
        <div className="cl-line">SENDER : {sender}</div>
        <div className="cl-line cl-cmdty">RECEIVER : {m.destPincode || '—'}{ourTag}</div>
      </section>

      {label('3 · STICK ON INVOICE')}

      <section className="cl">
        <div className="cl-copy">4 · CARRIER POD COPY</div>
        <div className="cl-title">{title}</div>
        <div className="cl-pod-head">POD COPY | <b>AWB: {lead} | BOXES: {m.pieceCount} NOS</b></div>
        <div className="cl-line">SENDER : {sender}</div>
        <div className="cl-line">RECEIVER : {m.destPincode || m.consignee.name}{ourTag}</div>
        <div className="cl-bar cl-bar-sm"><Barcode value={lead} /></div>
        <table className="cl-pod">
          <thead><tr><th>RECEIVED BY</th><th>SEAL / SIGNATURE</th><th>RECEIVED ON</th><th>REMARKS</th></tr></thead>
          <tbody><tr><td /><td /><td /><td /></tr></tbody>
        </table>
      </section>

      {label('5 · SHIPPER COPY')}

      {boxes.map((b, i) => {
        const boxNo = b.carrierId || `${lead}-${String(i + 1).padStart(4, '0')}`;
        return (
          <section className="cl" key={`box${i}`}>
            <div className="cl-copy">{6 + i} · BOX {i + 1} OF {boxes.length}</div>
            <div className="cl-title">{title}</div>
            <div className="cl-line cl-big">Org: {org} - Dst: {dst}{m.referenceNo ? <span className="cl-small"> | Ref No: {m.referenceNo}</span> : null}</div>
            <div className="cl-line cl-big">Boxes: {i + 1} of {boxes.length} | Date:{date}{b.deadKg ? <span className="cl-small"> | {Number(b.deadKg).toFixed(2)} KGs</span> : null}</div>
            <div className="cl-bar">
              <Barcode value={boxNo} />
              <div className="cl-our">{boxNo}{!isOwn ? <> · Our AWB: <b>{m.awb}</b></> : null}</div>
            </div>
            <div className="cl-line">Sender: {sender}</div>
            <div className="cl-line">Inv No: {m.invoiceNo || '—'} | Inv Val: {money(m.shipmentValue) || '—'} INR</div>
            <div className="cl-recv">
              <div>Receiver : {m.consignee.name}</div>
              <div className="cl-addr">{m.consignee.address}</div>
              <div>Pincode : {m.destPincode || '—'} Ph: {m.consigneePhone || m.consignee.phone || '—'}</div>
            </div>
          </section>
        );
      })}

      <style>{`
        .cl-page { background:#eee; min-height:100vh; padding:16px; display:flex; flex-direction:column; align-items:center; gap:14px; }
        .cl-toolbar { width:89mm; display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:13px; }
        .cl-toolbar button { padding:6px 14px; font-weight:700; cursor:pointer; }
        .cl-hint { color:#555; font-size:12px; }
        .cl-warn { width:89mm; background:#fff3cd; border:1.5px solid #e0a800; color:#664d03; border-radius:6px; padding:8px 10px; font-size:12px; line-height:1.4; }
        .cl { width:89mm; height:69mm; box-sizing:border-box; background:#fff; color:#111; padding:2.2mm 2.6mm; overflow:hidden; position:relative;
          font-family: 'DejaVu Sans', Arial, sans-serif; font-size:7.6pt; line-height:1.22; display:flex; flex-direction:column; }
        .cl-copy { position:absolute; top:1mm; right:2mm; font-size:5.5pt; color:#555; letter-spacing:.3px; }
        .cl-title { text-align:center; font-weight:800; font-size:14pt; letter-spacing:.5px; border-bottom:1.2px solid #111; padding-bottom:.6mm; }
        .cl-line { border-bottom:1px solid #111; padding:.55mm 0; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cl-big { font-size:9pt; }
        .cl-small { font-size:7pt; }
        .cl-bar { text-align:center; padding:.8mm 0 .4mm; border-bottom:1px solid #111; }
        .cl-bar svg { width:84%; height:15mm; }
        .cl-bar-sm svg { height:11mm; }
        .cl-our { font-size:7pt; margin-top:.3mm; }
        .cl-recv { border-bottom:1.2px solid #111; padding:.6mm 0; font-weight:700; font-size:8pt; }
        .cl-addr { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cl-cmdty { border-bottom:0; }
        .cl-pod-head { text-align:center; font-size:8.5pt; padding:.6mm 0; }
        .cl-pod { width:100%; border-collapse:collapse; margin-top:1mm; flex:1; }
        .cl-pod th, .cl-pod td { border:1.2px solid #111; font-size:6.5pt; padding:.6mm; text-align:center; }
        .cl-pod td { height:14mm; }
        .cl-boxes { flex:0; margin:1mm 0; }
        .cl-boxes td { height:auto; font-size:7pt; font-weight:700; }
        @media print {
          .cl-page { background:#fff; padding:0; gap:0; display:block; }
          .no-print { display:none !important; }
          .cl { page-break-after:always; break-after:page; }
          @page { size:89mm 69mm; margin:0; }
        }
      `}</style>
    </div>
  );
}
