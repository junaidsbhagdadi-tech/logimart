import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../format';
import { StatusBadge } from '../components/StatusBadge';

const WINDOWS: [string, string][] = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']];
const TABS = ['Home', 'Shipments', 'Exceptions', 'Returns', 'Analytics'] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABEL: Record<string, string> = { MAN: 'Booked', PKD: 'Picked', ORD: 'At origin hub', DPD: 'In transit', DRD: 'At dest hub', OFD: 'Out for delivery', DLD: 'Delivered', UDL: 'Undelivered', RTO: 'Return to origin', RTD: 'Return delivered', CAN: 'Cancelled' };
const statusColor = (c: string) => (['DLD', 'RTD'].includes(c) ? '#16a34a' : ['UDL', 'RTO'].includes(c) ? '#c0392b' : c === 'OFD' ? '#d97706' : c === 'CAN' ? '#6b7280' : '#2563eb');

function Kpi({ label, value, color, icon, to }: { label: string; value: number | string; color: string; icon: string; to?: string }) {
  const body = (
    <div className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, borderLeft: `4px solid ${color}`, minHeight: 92 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.3px' }}>{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{value}</div>
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : body;
}

export function ShippingHub() {
  const { user } = useAuth();
  const isOps = ['HUB_MANAGER', 'SYS_ADMIN', 'FINANCE_EXEC'].includes(user?.role || '');
  const [tab, setTab] = useState<Tab>('Home');
  const [win, setWin] = useState('7d');
  const [hub, setHub] = useState<any>(null);
  const [bd, setBd] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [xb, setXb] = useState<any>(null);
  const [gati, setGati] = useState<any>(null);
  const [vx, setVx] = useState<any>(null);
  const [arl, setArl] = useState<any>(null);
  const [pickups, setPickups] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadHome = () => {
    api.statsHub(win).then(setHub).catch(() => {});
    api.bdStatus().then(setBd).catch(() => {});
    api.delStatus().then(setDel).catch(() => {});
    api.xbStatus().then(setXb).catch(() => {});
    api.gatiStatus().then(setGati).catch(() => {});
    api.vxStatus().then(setVx).catch(() => {});
    api.arlStatus().then(setArl).catch(() => {});
    api.pickupsUnified({ window: 'all' }).then(setPickups).catch(() => {});
  };
  useEffect(loadHome, [win]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (['Shipments', 'Exceptions', 'Returns'].includes(tab)) api.awbList(300, search.trim() || undefined).then(setRows).catch(() => {});
      if (tab === 'Analytics' && isOps) api.statsOverview().then(setOverview).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [tab, search]);

  // statusCode is authoritative — the carrier syncs write BlueDart/Delhivery status through to it.
  const effCode = (r: any) => String(r.statusCode || 'MAN').toUpperCase();
  const filtered = () => {
    if (tab === 'Exceptions') return rows.filter((r) => ['UDL', 'RTO'].includes(effCode(r)));
    if (tab === 'Returns') return rows.filter((r) => ['RTO', 'RTD'].includes(effCode(r)));
    return rows;
  };

  const dispatchBd = async () => { setBusy(true); setMsg(''); try { const r = await api.bdDispatchAll(); setMsg(r.message); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); } };
  const markPicked = async (p: any) => { if (p.source !== 'REQUEST' || !p.requestId) return; try { await api.completePickup(p.requestId); api.pickupsUnified({ window: 'all' }).then(setPickups); } catch { /* */ } };

  const dt = (s?: string | null) => (s ? fmtDate(s) : '—');
  const pendingPickups = pickups.filter((p) => p.status === 'PENDING' || p.status === 'SCHEDULED');

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>🚚 Shipping Hub</h1>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>Multi-carrier operations — one place for shipments, pickups & carriers.</p>
        </div>
        {tab === 'Home' && (
          <div className="row" style={{ gap: 4 }}>
            {WINDOWS.map(([k, l]) => <button key={k} className={win === k ? '' : 'secondary'} style={{ padding: '5px 12px' }} onClick={() => setWin(k)}>{l}</button>)}
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 6, margin: '12px 0', overflowX: 'auto', paddingBottom: 2 }}>
        {TABS.filter((t) => t !== 'Analytics' || isOps).map((t) => (
          <button key={t} className={tab === t ? '' : 'secondary'} style={{ padding: '6px 14px', whiteSpace: 'nowrap' }} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)' }}>{msg}</div>}

      {tab === 'Home' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <Kpi label="Shipments" value={hub?.total ?? '—'} color="#2563eb" icon="📦" />
            <Kpi label="Delivered" value={hub?.delivered ?? '—'} color="#16a34a" icon="✅" />
            <Kpi label="In transit" value={hub?.inTransit ?? '—'} color="#2563eb" icon="🚚" />
            <Kpi label="Out for delivery" value={hub?.outForDelivery ?? '—'} color="#d97706" icon="🛵" />
            <Kpi label="Exceptions" value={hub?.exceptions ?? '—'} color="#c0392b" icon="⚠️" />
            <Kpi label="Pending pickups" value={hub?.pendingPickups ?? '—'} color="#7c3aed" icon="📍" />
            <Kpi label="To book" value={hub?.pendingBooking ?? '—'} color="#6b7280" icon="🧾" />
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 16 }}>⚡ Quick actions</h2>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Link to="/create"><button>➕ New shipment</button></Link>
              <Link to="/pickups"><button className="secondary">📦 Schedule pickup</button></Link>
              <Link to="/tracker"><button className="secondary">🧭 Track</button></Link>
              <Link to="/bulk"><button className="secondary">📥 Bulk booking</button></Link>
              {isOps && <button className="secondary" onClick={dispatchBd} disabled={busy}>{busy ? 'Sending…' : '📤 Send pending to BlueDart'}</button>}
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 16 }}>🔌 Carriers</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {[{ name: 'BlueDart', ok: bd?.configured, to: '/bluedart', icon: '🔵' }, { name: 'Delhivery', ok: del?.configured, to: '/bluedart', icon: '🟠' }, { name: 'XpressBees', ok: xb?.configured, to: '/bluedart', icon: '🐝' }, { name: 'Gati', ok: gati?.configured, to: '/bluedart', icon: '🟦' }, { name: 'V Express', ok: vx?.configured, to: '/bluedart', icon: '🟩' }, { name: 'AR Logistics', ok: arl?.configured, to: '/bluedart', icon: '🟥' }, { name: 'Self / Riders', ok: true, to: '/riders', icon: '🏍' }].map((c) => {
                const cnt = hub?.carriers?.find((x: any) => new RegExp(c.name.split(' ')[0], 'i').test(x.vendor) || (c.name.startsWith('Self') && /SELF|BDR/i.test(x.vendor)))?.count;
                return (
                  <Link key={c.name} to={c.to} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card" style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div><div style={{ fontWeight: 700 }}>{c.icon} {c.name}</div><div className="muted" style={{ fontSize: 12 }}>{cnt != null ? `${cnt} in window` : 'carrier'}</div></div>
                      <span className={`badge ${c.ok ? 'DELIVERED' : 'CANCELLED'}`}>{c.ok ? 'Connected' : 'Set up'}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>📍 Pickups board</h2>
              <Link to="/pickups" style={{ fontSize: 13 }}>View all →</Link>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{pendingPickups.length} pending / scheduled across all carriers.</p>
            <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
              {pendingPickups.slice(0, 8).map((p) => (
                <div key={p.id} className="card" style={{ margin: 0, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      <span className="badge" style={{ marginRight: 6 }}>{p.carrier}</span>
                      {p.customer || p.awb || p.ref || '—'}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{[p.address, p.city, p.pincode].filter(Boolean).join(', ') || '—'} · {p.pieces || 1} pcs · {dt(p.scheduledAt)}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {p.contact && <a href={`tel:${p.contact}`}><button className="secondary" style={{ padding: '4px 10px' }}>📞</button></a>}
                    {p.source === 'REQUEST' ? <button className="secondary" style={{ padding: '4px 10px' }} onClick={() => markPicked(p)}>✓ Picked</button>
                      : p.awb ? <Link to={`/shipments/${p.awb}`}><button className="secondary" style={{ padding: '4px 10px' }}>Open</button></Link> : null}
                  </div>
                </div>
              ))}
              {pendingPickups.length === 0 && <div className="muted">No pending pickups.</div>}
            </div>
          </div>
        </>
      )}

      {(tab === 'Shipments' || tab === 'Exceptions' || tab === 'Returns') && (
        <div className="card">
          <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search AWB / consignee / waybill…" style={{ flex: 1, minWidth: 200 }} />
            <span className="muted" style={{ fontSize: 12 }}>{filtered().length}</span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered().map((r) => {
              const code = effCode(r);
              return (
                <Link key={r.awb} to={`/shipments/${r.awb}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="card" style={{ margin: 0, padding: 10 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <strong>{r.awb}</strong>
                      <StatusBadge code={code} label={STATUS_LABEL[code] || undefined} />
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{r.consigneeName || '—'} → {r.destination || '—'} · {r.vendor || 'SELF'}{r.forwardingAwb ? ` · ${r.forwardingAwb}` : ''}{r.bdStatus ? ` · ${r.bdStatus}` : ''}</div>
                  </div>
                </Link>
              );
            })}
            {filtered().length === 0 && <div className="muted">No {tab.toLowerCase()}{search ? ' for this search' : ''}.</div>}
          </div>
        </div>
      )}

      {tab === 'Analytics' && isOps && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Analytics <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(all-time)</span></h2>
          {overview ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
                <Kpi label="Total shipments" value={overview.shipments.total} color="#2563eb" icon="📦" />
                <Kpi label="Delivered %" value={`${overview.deliveredPct}%`} color="#16a34a" icon="✅" />
                <Kpi label="Pieces in transit" value={overview.piecesInTransit} color="#2563eb" icon="🚚" />
                <Kpi label="Open exceptions" value={overview.openExceptions} color="#c0392b" icon="⚠️" />
              </div>
              <h3 style={{ fontSize: 14 }}>By status</h3>
              <table style={{ fontSize: 13 }}>
                <tbody>{Object.entries(overview.shipments.byStatus).map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{String(v)}</td></tr>)}</tbody>
              </table>
            </>
          ) : <p className="muted">Loading…</p>}
        </div>
      )}
    </div>
  );
}
