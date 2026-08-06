import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Logo } from './Logo';
import { FeedbackWidget } from './FeedbackWidget';

export function Layout() {
  const { user, logout } = useAuth();
  const isAdminFin = user?.role === 'FINANCE_EXEC' || user?.role === 'SYS_ADMIN';
  const isOps = ['HUB_MANAGER', 'DRIVER', 'SYS_ADMIN'].includes(user?.role || '');
  const canMaster = user?.role === 'HUB_MANAGER' || user?.role === 'SYS_ADMIN';
  const nav = useNavigate();
  const [awb, setAwb] = useState('');
  const onLogout = () => {
    logout();
    nav('/login');
  };
  const lookupAwb = (e: React.FormEvent) => {
    e.preventDefault();
    const q = awb.trim();
    if (!q) return;
    nav(`/shipments/${encodeURIComponent(q)}`);
    setAwb('');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo-box">
          <Logo height={38} />
        </div>
        <form onSubmit={lookupAwb} className="awb-lookup" style={{ padding: '0 12px 10px' }}>
          <input
            value={awb}
            onChange={(e) => setAwb(e.target.value)}
            placeholder="🔍 AWB lookup…"
            aria-label="AWB lookup"
            style={{ width: '100%', fontSize: 13, padding: '8px 10px' }}
          />
        </form>
        <nav>
          <NavLink to="/" end>📊 Dashboard</NavLink>
          <NavLink to="/create">➕ New Shipment</NavLink>
          {isOps && <NavLink to="/my-tasks">🛵 My Tasks</NavLink>}
          <NavLink to="/pickups">📦 Pickups</NavLink>
          {isOps && <NavLink to="/manifests">🚚 Manifests</NavLink>}
          <NavLink to="/invoices">🧾 Invoices</NavLink>
          {isAdminFin && <NavLink to="/receivables">📒 Receivables</NavLink>}
          {isAdminFin && <NavLink to="/notes">± Debit/Credit Notes</NavLink>}
          {isAdminFin && <NavLink to="/claims">🛡 Claims</NavLink>}
          {isAdminFin && <NavLink to="/customers">👥 Customers</NavLink>}
          {isAdminFin && <NavLink to="/vendors">🏢 Vendors</NavLink>}
          {isAdminFin && <NavLink to="/documents">📁 Documents</NavLink>}
          {isAdminFin && <NavLink to="/sales">📈 Sales</NavLink>}
          {isAdminFin && <NavLink to="/rates">💱 Rate Matrix</NavLink>}
          {canMaster && <NavLink to="/master-data">🗺 Serviceability</NavLink>}
          {isAdminFin && <NavLink to="/tax">🧾 Tax Filing</NavLink>}
          {user?.role === 'SYS_ADMIN' && <NavLink to="/users">⚙️ Users</NavLink>}
          {user?.role === 'SYS_ADMIN' && <NavLink to="/audit">🕵 Audit Log</NavLink>}
          {user?.role === 'SYS_ADMIN' && <NavLink to="/feedback">💬 Feedback</NavLink>}
        </nav>
        <div className="userbox">
          <div className="name">{user?.fullName}</div>
          <div className="role">{user?.role}</div>
          <button className="secondary" style={{ marginTop: 10, width: '100%' }} onClick={onLogout}>
            Logout
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <FeedbackWidget />
    </div>
  );
}
