import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ShipmentRow } from '../api';
import { useAuth } from '../auth';

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
                  <td>{r.serviceMode}</td>
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
