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
          <div className="muted">Domestic Air &amp; Road</div>
        </div>
        <form onSubmit={search} className="row" style={{ gap: 8 }}>
          <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Enter AWB e.g. LMT2026000001" style={{ flex: 1 }} />
          <button type="submit">Track</button>
        </form>
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

        {result && (
          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{result.awb}</strong>
              <span className={`badge ${result.status}`}>{result.status}</span>
            </div>
            <p className="muted">
              To {result.destination} · {result.delivered}/{result.pieceCount} boxes delivered
              {result.isShort && ' · SHORT'}
            </p>
            <ol className="timeline">
              {result.timeline.map((t) => (
                <li key={t.checkpoint}>
                  <strong>{t.label}</strong>
                  <span className="muted"> — {new Date(t.at).toLocaleString()}</span>
                </li>
              ))}
              {result.timeline.length === 0 && <li className="muted">No scans yet.</li>}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
