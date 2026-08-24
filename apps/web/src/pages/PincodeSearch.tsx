import { FormEvent, useState } from 'react';
import { api } from '../api';

type PinInfo = Awaited<ReturnType<typeof api.lookupPincode>>;
type Opt = { network: string; mode: string | null; tatDays: number | null; isOda: boolean; city: string | null };

function Field({ label, value, color }: { label: string; value?: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || 'var(--text)', marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  );
}

export function PincodeSearch() {
  const [pin, setPin] = useState('');
  const [info, setInfo] = useState<PinInfo | null>(null);
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = pin.trim();
    if (!/^\d{6}$/.test(q)) { setError('Enter a valid 6-digit pincode.'); return; }
    setError(''); setBusy(true); setInfo(null); setOpts(null);
    try {
      const [i, o] = await Promise.all([
        api.lookupPincode(q).catch(() => null),
        api.serviceOptions(q).catch(() => [] as Opt[]),
      ]);
      setInfo(i); setOpts(o); setSearched(true);
    } catch (err: any) { setError(err.message || 'Lookup failed'); }
    finally { setBusy(false); }
  };

  const fastest = opts && opts.length ? Math.min(...opts.map((o) => o.tatDays ?? 9999).filter((n) => n < 9999)) : null;

  return (
    <div style={{ minHeight: searched ? undefined : '62vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: searched ? 'flex-start' : 'center' }}>
      <div style={{ textAlign: 'center', width: '100%' }}>
        {!searched && <div style={{ fontSize: 46, lineHeight: 1 }}>📍</div>}
        <h1 style={{ marginBottom: 4 }}>{searched ? '📍 Pincode Serviceability' : 'Pincode Serviceability'}</h1>
        {!searched && <div className="muted" style={{ marginBottom: 10 }}>Check which products &amp; carriers serve a destination pincode, with transit days.</div>}
        <form onSubmit={search} className="row" style={{ gap: 10, justifyContent: 'center', width: '100%', maxWidth: 540, margin: '0 auto', marginTop: 4 }}>
          <input autoFocus value={pin} maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit pincode…" style={{ flex: 1, maxWidth: 380, padding: '12px 16px', fontSize: 16 }} />
          <button disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        </form>
        {error && <div className="error" style={{ marginTop: 8, maxWidth: 540, width: '100%', marginLeft: 'auto', marginRight: 'auto' }}>{error}</div>}
      </div>

      {searched && (
        <div style={{ width: '100%', marginTop: 18 }}>
          {/* Pincode info */}
          <div className="card">
            <div className="grid cols-4" style={{ gap: 14 }}>
              <Field label="Pincode" value={pin} />
              <Field label="City" value={info?.city} />
              <Field label="State" value={info?.state} />
              <Field label="Region / Zone" value={info?.region} />
              <Field label="Tier" value={info?.tier != null ? `Tier ${info.tier}` : '—'} />
              <Field label="ODA (out-of-delivery-area)" value={info?.isOda ? 'Yes' : 'No'} color={info?.isOda ? 'var(--warn, #b26a00)' : 'var(--ok, #16a34a)'} />
              <Field label="Serviceable" value={(opts && opts.length) ? 'Yes' : (info?.known ? 'Directory only' : 'No')} color={(opts && opts.length) ? 'var(--ok, #16a34a)' : 'var(--muted)'} />
              <Field label="Fastest transit" value={fastest != null ? `${fastest} day${fastest === 1 ? '' : 's'}` : '—'} />
            </div>
          </div>

          {/* Products / carriers serving it */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Products &amp; carriers serving {pin} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>({opts?.length ?? 0})</span></h2>
            {opts && opts.length ? (
              <table>
                <thead><tr><th>Network / Product</th><th>Mode</th><th>Transit (TAT)</th><th>ODA</th></tr></thead>
                <tbody>
                  {opts.map((o) => (
                    <tr key={o.network}>
                      <td><strong>{o.network}</strong></td>
                      <td>{o.mode ?? '—'}</td>
                      <td>{o.tatDays != null ? `${o.tatDays} day${o.tatDays === 1 ? '' : 's'}` : '—'}</td>
                      <td>{o.isOda ? <span className="badge" style={{ background: '#fff3d6', color: '#8a6100' }}>ODA</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="muted" style={{ padding: '10px 2px' }}>
                No products mapped for this pincode{info?.known ? ' (it is in the pincode directory, but no serviceable network covers it yet).' : ' — pincode not in the serviceability list.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
