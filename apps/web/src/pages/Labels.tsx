import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, LabelItem, MasterLabel } from '../api';
import { Barcode } from '../components/Barcode';
import { Logo } from '../components/Logo';

export function Labels() {
  const { awb } = useParams();
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [master, setMaster] = useState<MasterLabel | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!awb) return;
    api.getLabels(awb).then((r) => { setLabels(r.labels); setMaster(r.master); }).catch((e) => setError(e.message));
  }, [awb]);

  if (error) return <div className="error">{error}</div>;

  return (
    <>
      <div className="row no-print" style={{ justifyContent: 'space-between' }}>
        <h1>Labels — {awb}</h1>
        <div className="row">
          <Link to={`/shipments/${awb}`}><button className="secondary">← Back</button></Link>
          <button onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      {/* ---- Full shipping (consignment) label ---- */}
      {master && (
        <div className="ship-label">
          <div className="ship-head">
            <Logo height={42} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Consignment Note</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{master.lrNumber}</div>
              <div style={{ fontSize: 12 }}>{master.serviceMode} · {master.route}</div>
            </div>
          </div>
          <div className="ship-grid">
            <div className="ship-box">
              <div className="ship-cap">From (Consignor)</div>
              <strong>{master.consignor.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{master.consignor.address}</div>
              {master.consignor.gstin && <div className="muted" style={{ fontSize: 11 }}>GSTIN: {master.consignor.gstin}</div>}
            </div>
            <div className="ship-box">
              <div className="ship-cap">To (Consignee)</div>
              <strong>{master.consignee.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{master.consignee.address}</div>
              {master.consignee.phone && <div className="muted" style={{ fontSize: 11 }}>📞 {master.consignee.phone}</div>}
              {master.consignee.gstin && <div className="muted" style={{ fontSize: 11 }}>GSTIN: {master.consignee.gstin}</div>}
            </div>
          </div>
          <div style={{ textAlign: 'center', margin: '6px 0' }}>
            <Barcode value={master.barcode} />
          </div>
          <div className="ship-foot">
            <span><strong>{master.pieceCount}</strong> pcs</span>
            <span>Dead <strong>{master.totalDeadKg}</strong> kg</span>
            <span>Vol <strong>{master.totalVolKg}</strong> kg</span>
            {master.declaredValue != null && <span>Value ₹{master.declaredValue}</span>}
            {master.ewbNo && <span>EWB {master.ewbNo}</span>}
          </div>
          {master.goodsDesc && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Goods: {master.goodsDesc}</div>}
        </div>
      )}

      <p className="muted no-print">
        Above: the full shipping (consignment) label. Below: {labels.length} MPS child-box labels —
        each with the master AWB, “Box n of {labels.length}”, a Code128 barcode of the child ID, and that box’s volumetric weight.
      </p>

      <div className="label-sheet">
        {labels.map((l) => (
          <div className="mps-label" key={l.childId}>
            <div className="hdr">
              <div>
                <strong>Logimart</strong>
                <div style={{ fontSize: 11 }}>Surface &amp; Domestic Air Cargo</div>
              </div>
              <div className="seq">{l.sequenceLabel}</div>
            </div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              AWB <strong>{l.masterAwb}</strong> · {l.serviceMode} · {l.route}
            </div>
            <Barcode value={l.barcode} />
            <div className="wt">
              <span>Dead: {l.deadKg} kg</span>
              <span>Vol: {l.volKg} kg</span>
            </div>
            <div style={{ fontSize: 11, marginTop: 4 }} className="muted">{l.client}</div>
          </div>
        ))}
      </div>
    </>
  );
}
