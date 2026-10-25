import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

/**
 * CS exceptions inbox — everything that needs a person, in one place: refused carrier hand-offs, bookings
 * not yet with a carrier, undelivered / RTO, no movement for 3+ days, e-way bill pending, invoices not sent,
 * pickup requests not actioned. Counts per bucket; pick one to work through it.
 */
type Bucket = { key: string; title: string; hint: string; items: any[] };

export function Exceptions() {
  const { user } = useAuth();
  const canHandoff = ['HUB_MANAGER', 'SYS_ADMIN', 'WAREHOUSE_HANDLER'].includes(user?.role || '');
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [active, setActive] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => {
    setLoading(true); setError('');
    api.exceptionsInbox()
      .then((r) => {
        setBuckets(r.buckets);
        setActive((cur) => cur || r.buckets.find((b) => b.items.length)?.key || r.buckets[0]?.key || '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const retry = async (awb: string) => {
    setBusy(awb); setMsg(''); setError('');
    try { const r = await api.carrierHandoff(awb); setMsg(`✓ ${awb}: ${r.message}`); load(); }
    catch (e: any) { setError(`${awb}: ${e.message}`); }
    finally { setBusy(''); }
  };

  const b = buckets.find((x) => x.key === active);
  const isShip = b && !['invoices_unsent', 'pickups_waiting'].includes(b.key);

  return (
    <>
      <h1>Exceptions</h1>
      <p className="muted" style={{ marginTop: -8 }}>Everything that needs someone today. Work a list down to zero; refresh to see what's left.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)', fontSize: 13 }}>{msg}</div>}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {buckets.map((x) => (
          <button key={x.key} className={x.key === active ? '' : 'secondary'} onClick={() => setActive(x.key)} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {x.title}
            <span className={`st ${x.items.length ? (['handoff_failed', 'undelivered', 'rto', 'ewb_pending'].includes(x.key) ? 'st-problem' : 'st-ofd') : 'st-done'}`}>{x.items.length}</span>
          </button>
        ))}
        <button className="secondary" onClick={load} disabled={loading}>{loading ? 'Loading…' : '⟳ Refresh'}</button>
      </div>

      {b && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0 }}>{b.title} <span className="muted" style={{ fontSize: 14 }}>({b.items.length})</span></h2>
            <span className="muted" style={{ fontSize: 12.5 }}>{b.hint}</span>
          </div>
          {!b.items.length ? <p className="muted" style={{ marginTop: 12 }}>Nothing here. 🎉</p> : (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              {isShip ? (
                <table style={{ fontSize: 13 }}>
                  <thead><tr><th>AWB</th><th>Customer</th><th>Carrier</th><th>Consignee / destination</th><th>Why</th><th>Age</th><th></th></tr></thead>
                  <tbody>
                    {b.items.map((r) => (
                      <tr key={r.awb}>
                        <td><Link to={`/shipments/${r.awb}`}><strong>{r.awb}</strong></Link>{r.carrierAwb && <div className="muted" style={{ fontSize: 11 }}>{r.carrierAwb}</div>}</td>
                        <td>{r.customer}</td>
                        <td>{r.vendor}</td>
                        <td>{r.consignee}<div className="muted" style={{ fontSize: 11 }}>{r.destination}</div></td>
                        <td style={{ maxWidth: 420 }}>{r.reason}</td>
                        <td>{r.ageDays != null ? `${r.ageDays}d` : ''}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {canHandoff && ['handoff_failed', 'awaiting_handoff'].includes(b.key) && (
                            <button style={{ padding: '3px 10px', fontSize: 12 }} disabled={busy === r.awb} onClick={() => retry(r.awb)}>{busy === r.awb ? 'Sending…' : 'Hand off'}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : b.key === 'invoices_unsent' ? (
                <table style={{ fontSize: 13 }}>
                  <thead><tr><th>Invoice</th><th>Customer</th><th style={{ textAlign: 'right' }}>Total</th><th>Age</th></tr></thead>
                  <tbody>
                    {b.items.map((r) => (
                      <tr key={r.invoiceId}>
                        <td><Link to={`/invoices/${r.invoiceId}`}><strong>{r.invoiceNo}</strong></Link></td>
                        <td>{r.customer}</td>
                        <td style={{ textAlign: 'right' }}>₹{Number(r.total).toLocaleString('en-IN')}</td>
                        <td>{r.ageDays != null ? `${r.ageDays}d` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={{ fontSize: 13 }}>
                  <thead><tr><th>Pickup</th><th>Customer</th><th>Address</th><th>Carrier</th><th>Waiting</th></tr></thead>
                  <tbody>
                    {b.items.map((r) => (
                      <tr key={r.pickupId}>
                        <td><Link to="/pickups"><strong>#{r.pickupId}</strong></Link></td>
                        <td>{r.customer}</td>
                        <td>{r.address}</td>
                        <td>{r.vendor || '—'}</td>
                        <td>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
