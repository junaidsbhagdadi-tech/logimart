import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/Logo';

type Result = Awaited<ReturnType<typeof api.track>>;

export function Track() {
  const { awb: awbParam } = useParams();
  const [awb, setAwb] = useState(awbParam ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    setResult(null);
    try {
      setResult(await api.track(awb.trim()));
    } catch (err: any) {
      setError(err.message || 'Not found');
    }
  };

  // auto-search if an AWB was in the URL
  useEffect(() => {
    if (awbParam) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18 }}>
          <Logo height={56} />
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)', marginTop: 10 }}>Track your shipment</div>
          <div className="muted">Surface &amp; Domestic Air Cargo</div>
        </div>
        <form onSubmit={search} className="row" style={{ gap: 8 }}>
          <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Enter AWB e.g. LMT2026000001" style={{ flex: 1 }} />
          <button type="submit">Track</button>
        </form>
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

        {result && (
          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{result.awb}</strong>
              <span className={`badge ${result.status}`}>{result.currentLabel}</span>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              To {result.destination} · {result.delivered}/{result.pieceCount} boxes delivered{result.isShort && ' · SHORT'}
              {result.expectedDelivery && <> · Est. delivery {new Date(result.expectedDelivery).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</>}
            </p>
            {(result as any).isOda && (
              <p style={{ marginTop: 4, fontSize: 13, color: 'var(--amber, #9a6a12)' }}>
                📍 This is an <strong>ODA (out‑of‑delivery‑area) location</strong> — please allow ~2 extra days beyond the estimated delivery date.
              </p>
            )}
            {result.timeline.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>No scans yet — your shipment is being processed.</p>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 18, marginTop: 14 }}>
                {result.timeline.map((t, i) => (
                  <div key={i} style={{ position: 'relative', paddingBottom: i === result.timeline.length - 1 ? 0 : 16 }}>
                    <span style={{ position: 'absolute', left: -18, top: 3, width: 10, height: 10, borderRadius: '50%', background: i === result.timeline.length - 1 ? 'var(--brand)' : 'var(--ok, #16a34a)' }} />
                    {i !== result.timeline.length - 1 && <span style={{ position: 'absolute', left: -14, top: 13, bottom: 0, width: 2, background: 'var(--border)' }} />}
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{t.label}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{new Date(t.at).toLocaleString('en-IN')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
