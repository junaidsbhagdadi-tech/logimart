import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, MasterLabel } from '../api';
import { Barcode } from '../components/Barcode';

/** #5 — BlueDart-style two-part shipping label (top: shipping label, bottom: box-details slip). */
const money = (v?: number | null) =>
  v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
const dt = (v?: string) => (v ? new Date(v).toLocaleDateString('en-GB') : '');

export function BdLabel() {
  const { awb } = useParams();
  const [m, setM] = useState<MasterLabel | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (awb) api.getLabels(awb).then((r) => setM(r.master)).catch((e) => setError(e.message));
  }, [awb]);

  if (error) return <div style={{ padding: 24, color: '#b00' }}>{error}</div>;
  if (!m) return <p style={{ padding: 24 }}>Loading…</p>;

  const modeLabel = (mode?: string) => (mode || '').toUpperCase().includes('AIR') ? 'AIR' : 'SURFACE';
  const carrier = m.vendor && m.vendor !== 'SELF' ? m.vendor : m.carrier.brand;
  const carrierLine = `${carrier} — ${modeLabel(m.serviceMode)}`;
  const wgt = (m.totalDeadKg || 0).toFixed(2);
  const org = [m.originCity, m.originZone].filter(Boolean).join(' / ') || m.originZone || '—';
  const dst = [m.consigneeCity, m.destZone].filter(Boolean).join(' / ') || m.destZone || '—';
  const invVal = money(m.shipmentValue);

  // group boxes by identical dimensions so the box-details table stays compact
  const dimKey = (b: { l: number; w: number; h: number }) => `${b.l}x${b.w}x${b.h}`;
  const groups = new Map<string, { dim: string; wt: number; count: number }>();
  (m.boxes || []).forEach((b) => {
    const k = dimKey(b);
    const g = groups.get(k) || { dim: `${b.l} x ${b.w} x ${b.h}`, wt: 0, count: 0 };
    g.wt += b.deadKg;
    g.count += 1;
    groups.set(k, g);
  });
  const rows = [...groups.values()];

  return (
    <div className="bd-page">
      <div className="bd-toolbar no-print">
        <Link to={`/shipments/${m.awb}/labels`}>← Box labels</Link>
        <button onClick={() => window.print()}>🖨 Print</button>
      </div>

      {/* ============ Part 1 — shipping label ============ */}
      <section className="bd-label">
        <div className="bd-head">{carrierLine}</div>

        <div className="bd-strip">
          <span>O REF NO: <b>{m.referenceNo || '—'}</b></span>
          <span>WGT: <b>{wgt} KGS</b></span>
          <span>MASTER — <b>{m.pieceCount} Pcs</b></span>
          <span>{dt(m.createdAt)}</span>
        </div>

        <div className="bd-orgdst">
          <div><span className="bd-lab">ORG</span> {org}</div>
          <div><span className="bd-lab">DST</span> {dst}</div>
        </div>

        <div className="bd-barcode">
          <Barcode value={m.barcode} />
          <div className="bd-awbno">{m.awb}</div>
        </div>

        <div className="bd-row">
          <span className="bd-lab">SENDER</span>
          <b>{m.accountCode || m.consignor.name}</b>
          {m.senderPincode ? <span className="bd-pin">{m.senderPincode}</span> : null}
        </div>

        <div className="bd-row bd-sub">
          <span>e-Way Bill: <b>{m.ewbNo || '—'}</b></span>
          <span>Inv No: <b>{m.referenceNo || '—'}</b></span>
          <span>Inv Val: <b>{invVal ? `₹${invVal}` : '—'}</b></span>
        </div>

        <div className="bd-recv">
          <div className="bd-lab">RECEIVER</div>
          <div className="bd-rname">{m.consignee.name}</div>
          <div className="bd-raddr">{m.consignee.address}</div>
          <div className="bd-row bd-sub">
            <span>PINCODE: <b>{m.destPincode || '—'}</b></span>
            <span>PH: <b>{m.consigneePhone || m.consignee.phone || '—'}</b></span>
          </div>
        </div>

        <div className="bd-cmdty">CMDTY: {m.goodsDesc || 'GOODS'}</div>
      </section>

      {/* ============ Part 2 — box-details slip ============ */}
      <section className="bd-label">
        <div className="bd-head">{carrierLine}</div>

        <div className="bd-strip">
          <span>AWB: <b>{m.awb}</b></span>
          <span>{dt(m.createdAt)}</span>
          <span>BOX DETAILS</span>
        </div>

        <div className="bd-row bd-sub">
          <span>INV NO: <b>{m.referenceNo || '—'}</b></span>
          <span>INV VAL: <b>{invVal ? `₹${invVal}` : '—'}</b></span>
        </div>

        <table className="bd-boxtable">
          <thead>
            <tr>
              <th>SL. NO</th>
              <th>DIMENSIONS (CMS)</th>
              <th>WEIGHT (KGS)</th>
              <th>NO. OF BOXES</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{r.dim}</td>
                  <td>{r.wt.toFixed(2)}</td>
                  <td>{r.count}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td>1</td>
                <td>—</td>
                <td>{wgt}</td>
                <td>{m.pieceCount}</td>
              </tr>
            )}
            <tr className="bd-total">
              <td></td>
              <td>Total</td>
              <td>{wgt} KGS</td>
              <td>{m.pieceCount}</td>
            </tr>
          </tbody>
        </table>

        <div className="bd-row bd-sub">
          <span>Receiver: <b>{m.consignee.name}</b> {m.destPincode || ''}</span>
        </div>
        <div className="bd-row bd-sub">
          <span>Sender: <b>{m.accountCode || m.consignor.name}</b> {m.senderPincode || ''}</span>
        </div>
      </section>

      <style>{`
        .bd-page { background:#eee; min-height:100vh; padding:16px; display:flex; flex-direction:column; align-items:center; gap:16px; }
        .bd-toolbar { width:384px; display:flex; justify-content:space-between; align-items:center; }
        .bd-toolbar button { padding:6px 16px; font-weight:700; cursor:pointer; }
        .bd-label { width:384px; background:#fff; color:#000; border:2px solid #000;
          font-family: 'Arial Narrow', Arial, sans-serif; font-size:12px; line-height:1.25; }
        .bd-head { background:#000; color:#fff; text-align:center; font-weight:800; font-size:16px; letter-spacing:1px; padding:6px 4px; }
        .bd-strip { display:flex; flex-wrap:wrap; gap:4px 10px; justify-content:space-between;
          border-bottom:1.5px solid #000; padding:5px 8px; font-size:11px; }
        .bd-orgdst { display:flex; border-bottom:2px solid #000; }
        .bd-orgdst > div { flex:1; padding:6px 8px; font-size:14px; font-weight:700; }
        .bd-orgdst > div:first-child { border-right:1.5px solid #000; }
        .bd-lab { display:inline-block; background:#000; color:#fff; font-size:9px; font-weight:700;
          padding:1px 5px; margin-right:6px; vertical-align:middle; }
        .bd-barcode { text-align:center; padding:8px 4px 4px; border-bottom:2px solid #000; }
        .bd-barcode svg { max-width:96%; height:70px; }
        .bd-awbno { font-size:20px; font-weight:800; letter-spacing:3px; margin-top:2px; }
        .bd-row { padding:5px 8px; border-bottom:1px solid #000; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .bd-row.bd-sub { font-size:11px; justify-content:space-between; }
        .bd-pin { margin-left:auto; font-weight:800; }
        .bd-recv { border-bottom:2px solid #000; padding:6px 8px; }
        .bd-rname { font-size:15px; font-weight:800; }
        .bd-raddr { font-size:12px; margin:2px 0 4px; }
        .bd-cmdty { padding:6px 8px; font-size:11px; font-weight:700; }
        .bd-boxtable { width:100%; border-collapse:collapse; font-size:11px; }
        .bd-boxtable th, .bd-boxtable td { border:1px solid #000; padding:4px 6px; text-align:center; }
        .bd-boxtable th { background:#000; color:#fff; font-size:10px; }
        .bd-total td { font-weight:800; }
        @media print {
          .bd-page { background:#fff; padding:0; gap:0; }
          .no-print { display:none !important; }
          .bd-label { border:1px solid #000; page-break-after:always; }
          @page { size:auto; margin:6mm; }
        }
      `}</style>
    </div>
  );
}
