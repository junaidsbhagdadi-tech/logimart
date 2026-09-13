import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';

/** BlueDart's OFFICIAL AWB print (AWBPrintContent) captured at hand-off — base64 PDF or image.
 *  Distinct from BdLabel.tsx, which is our own BlueDart-style artwork. */
export function BdAwbPrint() {
  const { awb } = useParams();
  const [src, setSrc] = useState('');
  const [isPdf, setIsPdf] = useState(true);
  const [wb, setWb] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!awb) return;
    api.bdLabelPrint(awb)
      .then((r) => {
        setWb(r.bdWaybill);
        const b64 = (r.label || '').replace(/^data:[^,]*,/, '').trim();
        // Detect the format from the base64 signature (BlueDart returns a PDF; images just in case).
        const mime = b64.startsWith('JVBERi0') ? 'application/pdf'
          : b64.startsWith('iVBORw0') ? 'image/png'
          : b64.startsWith('/9j/') ? 'image/jpeg'
          : 'application/pdf';
        setIsPdf(mime === 'application/pdf');
        setSrc(`data:${mime};base64,${b64}`);
      })
      .catch((e) => setError(e.message));
  }, [awb]);

  if (error) return <div style={{ padding: 24, color: '#b00' }}>{error}</div>;
  if (!src) return <p style={{ padding: 24 }}>Loading BlueDart AWB…</p>;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="no-print" style={{ padding: 8, display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #ccc' }}>
        <b>BlueDart AWB {wb || ''}</b>
        <span className="muted" style={{ fontSize: 12 }}>Ref: {awb}</span>
        {!isPdf && <button onClick={() => window.print()}>🖨 Print</button>}
        <a href={src} download={`bluedart-${wb || awb}.${isPdf ? 'pdf' : 'png'}`}><button className="secondary">⬇ Download</button></a>
        <span className="muted" style={{ fontSize: 12 }}>{isPdf ? 'Use the PDF viewer’s print/download controls.' : ''}</span>
      </div>
      {isPdf
        ? <iframe title="BlueDart AWB" src={src} style={{ flex: 1, border: 0, width: '100%' }} />
        : <img src={src} alt="BlueDart AWB" style={{ maxWidth: '100%', display: 'block', margin: '12px auto' }} />}
    </div>
  );
}
