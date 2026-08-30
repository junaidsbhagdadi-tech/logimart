import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ShipmentRow } from '../api';
import { useAuth } from '../auth';
import { modeLabel } from '../productMode';

type Stats = Awaited<ReturnType<typeof api.statsOverview>>;

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card kpi" style={{ flex: 1, minWidth: 158 }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 27, fontWeight: 800, color: tone || 'var(--navy)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const isStaff = ['FINANCE_EXEC', 'HUB_MANAGER', 'SYS_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listShipments()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    if (isStaff) api.statsOverview().then(setStats).catch(() => {});
  }, [isStaff]);

  return (
    <>
      {stats && (
        <>
          <h1>Overview</h1>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
            <Kpi label="Total shipments" value={stats.shipments.total} />
            <Kpi label="Delivered" value={`${stats.deliveredPct}%`} tone="var(--ok)" />
            <Kpi label="Pieces in transit" value={stats.piecesInTransit} />
            <Kpi label="Open exceptions" value={stats.openExceptions} tone={stats.openExceptions ? 'var(--bad)' : 'var(--ok)'} />
            <Kpi label="Revenue (month)" value={`₹${stats.revenueThisMonth.toLocaleString('en-IN')}`} />
            <Kpi label="Receivables" value={`₹${stats.outstandingReceivables.toLocaleString('en-IN')}`} />
            <Kpi label="Customers" value={stats.clientCount} />
            <Kpi label="On credit hold" value={stats.clientsOnHold} tone={stats.clientsOnHold ? 'var(--warn)' : 'var(--ok)'} />
          </div>
          {(stats as any).revenueTrend?.length > 0 && (() => {
            const trend = (stats as any).revenueTrend as { label: string; total: number }[];
            const max = Math.max(1, ...trend.map((t) => t.total));
            return (
              <div className="card" style={{ marginBottom: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><h2 style={{ margin: 0, fontSize: 17 }}>📈 Revenue trend</h2><span className="muted" style={{ fontSize: 12 }}>invoiced, last 6 months</span></div>
                <div className="row" style={{ alignItems: 'flex-end', gap: 14, height: 140, marginTop: 12 }}>
                  {trend.map((t, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{t.total >= 1e5 ? `₹${(t.total / 1e5).toFixed(1)}L` : t.total >= 1000 ? `₹${(t.total / 1000).toFixed(0)}k` : `₹${t.total}`}</div>
                      <div title={`₹${t.total.toLocaleString('en-IN')}`} style={{ width: '100%', maxWidth: 54, height: `${Math.max(4, (t.total / max) * 100)}%`, background: 'linear-gradient(180deg, var(--brand) 0%, var(--brand-2, #16308f) 100%)', borderRadius: '6px 6px 0 0', transition: 'height .4s' }} />
                      <div className="muted" style={{ fontSize: 11 }}>{t.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}
      <h1>Shipments</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No shipments yet. <Link to="/create">Create one →</Link></p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>AWB</th>
                <th>Route</th>
                <th>Mode</th>
                <th>Boxes</th>
                <th>Weight (dead/vol)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.awb}>
                  <td><Link to={`/shipments/${r.awb}`}><strong>{r.awb}</strong></Link></td>
                  <td>{r.route}</td>
                  <td>{modeLabel(r.serviceMode)}</td>
                  <td>{r.delivered}/{r.pieceCount}</td>
                  <td>{r.totalDeadKg} / {r.totalVolKg} kg</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
