import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Logo } from './Logo';
import { FeedbackWidget } from './FeedbackWidget';

type Item = { to: string; icon: string; label: string; end?: boolean; show?: boolean };
type Group = { title: string; items: Item[] };

export function Layout() {
  const { user, logout } = useAuth();
  const role = user?.role || '';
  const isAdminFin = role === 'FINANCE_EXEC' || role === 'SYS_ADMIN';
  const isOps = ['HUB_MANAGER', 'DRIVER', 'SYS_ADMIN'].includes(role);
  const canMaster = role === 'HUB_MANAGER' || role === 'SYS_ADMIN';
  const isSysAdmin = role === 'SYS_ADMIN';
  const nav = useNavigate();
  const [awb, setAwb] = useState('');

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lm.rail') === '1');
  const toggleRail = () => setCollapsed((c) => { const n = !c; localStorage.setItem('lm.rail', n ? '1' : '0'); return n; });

  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('lm.navClosed') || '{}'); } catch { return {}; }
  });
  const toggleGroup = (title: string) => setClosed((c) => {
    const n = { ...c, [title]: !c[title] }; localStorage.setItem('lm.navClosed', JSON.stringify(n)); return n;
  });

  const groups: Group[] = [
    { title: 'Overview', items: [
      { to: '/', icon: '📊', label: 'Dashboard', end: true },
    ] },
    { title: 'Operations', items: [
      { to: '/create', icon: '➕', label: 'New Shipment' },
      { to: '/awb-list', icon: '📝', label: 'Shipment List' },
      { to: '/bulk', icon: '📥', label: 'Bulk Booking' },
      { to: '/walk-in', icon: '🧾', label: 'Walk-in Counter', show: isAdminFin || canMaster },
      { to: '/my-tasks', icon: '🛵', label: 'My Tasks', show: isOps },
      { to: '/deliver', icon: '🚚', label: 'Delivery App', show: isOps },
      { to: '/pickups', icon: '📦', label: 'Pickups' },
      { to: '/manifests', icon: '🗺', label: 'Manifests', show: isOps },
    ] },
    { title: 'First Mile', items: [
      { to: '/fm', icon: '📊', label: 'Dashboard', end: true },
      { to: '/fm/pickup-outscan', icon: '📍', label: 'Pickup Outscan' },
      { to: '/fm/bulk-pickup-outscan', icon: '📥', label: 'Bulk Pickup Outscan' },
      { to: '/fm/update-pickup', icon: '✏️', label: 'Update Pickup' },
    ] },
    { title: 'Mid Mile', items: [
      { to: '/mm', icon: '📊', label: 'Dashboard', end: true },
      { to: '/mm/inscan-shipment', icon: '📲', label: 'Inscan Shipment' },
      { to: '/mm/bagging', icon: '🧳', label: 'Bagging' },
      { to: '/mm/trips', icon: '🚛', label: 'Trips' },
      { to: '/mm/unloaded-bags', icon: '📦', label: 'Unloaded Bags' },
      { to: '/mm/inscan-trip', icon: '🧾', label: 'Inscan Trip' },
    ] },
    { title: 'Last Mile', items: [
      { to: '/lm', icon: '📊', label: 'Dashboard', end: true },
      { to: '/lm/inscan-shipment', icon: '📲', label: 'Inscan Shipment' },
      { to: '/lm/inscan-trip', icon: '🧾', label: 'Inscan Trip' },
      { to: '/lm/delivery-outscan', icon: '🛵', label: 'Delivery Outscan' },
      { to: '/lm/update-delivery', icon: '✅', label: 'Update Delivery' },
      { to: '/lm/bulk-delivery-update', icon: '📥', label: 'Bulk Delivery Update' },
    ] },
    { title: 'Billing & CRM', items: [
      { to: '/invoices', icon: '🧾', label: 'Invoices' },
      { to: '/bill-worksheet', icon: '📋', label: 'Bill Worksheet', show: isAdminFin },
      { to: '/receivables', icon: '📒', label: 'Receivables', show: isAdminFin },
      { to: '/notes', icon: '±', label: 'Debit / Credit Notes', show: isAdminFin },
      { to: '/claims', icon: '🛡', label: 'Claims', show: isAdminFin },
      { to: '/customers', icon: '👥', label: 'Customers', show: isAdminFin },
      { to: '/vendors', icon: '🏢', label: 'Vendors', show: isAdminFin },
      { to: '/vehicles', icon: '🚚', label: 'Vehicles', show: isAdminFin },
      { to: '/vendor-bills', icon: '🚚', label: 'Vendor Bills & P&L', show: isAdminFin },
      { to: '/documents', icon: '📁', label: 'Documents', show: isAdminFin },
      { to: '/sales', icon: '📈', label: 'Sales', show: isAdminFin },
    ] },
    { title: 'Masters & Setup', items: [
      { to: '/ftl-rates', icon: '🚛', label: 'FTL Rates', show: isAdminFin },
      { to: '/service-mapping', icon: '🔀', label: 'Service Mapping', show: canMaster },
      { to: '/pincodes', icon: '📍', label: 'Pincodes and TAT', show: canMaster },
      { to: '/masters', icon: '🗃', label: 'Masters', show: canMaster },
      { to: '/tax', icon: '🧮', label: 'Tax Filing', show: isAdminFin },
    ] },
    { title: 'Insights & Admin', items: [
      { to: '/reports', icon: '📈', label: 'Reports', show: isAdminFin || canMaster },
      { to: '/users', icon: '⚙️', label: 'Users', show: isSysAdmin },
      { to: '/audit', icon: '🕵', label: 'Audit Log', show: isSysAdmin },
      { to: '/feedback', icon: '💬', label: 'Feedback', show: isSysAdmin },
    ] },
  ];

  const onLogout = () => { logout(); nav('/login'); };
  const lookupAwb = (e: React.FormEvent) => {
    e.preventDefault();
    const q = awb.trim();
    if (!q) return;
    nav(`/shipments/${encodeURIComponent(q)}`);
    setAwb('');
  };

  return (
    <div className="app">
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <button className="rail-toggle" onClick={toggleRail} title={collapsed ? 'Expand menu' : 'Collapse menu'} aria-label="Toggle menu">
          {collapsed ? '»' : '«'}
        </button>
        <div className="logo-box">
          <Logo height={collapsed ? 30 : 38} />
        </div>
        {!collapsed && (
          <form onSubmit={lookupAwb} className="awb-lookup" style={{ padding: '0 12px 10px' }}>
            <input
              value={awb}
              onChange={(e) => setAwb(e.target.value)}
              placeholder="🔍 AWB lookup…"
              aria-label="AWB lookup"
              style={{ width: '100%', fontSize: 13, padding: '8px 10px' }}
            />
          </form>
        )}
        <nav>
          {groups.map((g) => {
            const items = g.items.filter((it) => it.show !== false);
            if (items.length === 0) return null;
            const isClosed = !!closed[g.title];
            return (
              <div key={g.title} className={isClosed ? 'nav-group closed' : 'nav-group'}>
                <button className="group-head" onClick={() => toggleGroup(g.title)} title={g.title}>
                  <span>{g.title}</span>
                  <span className="chev">▼</span>
                </button>
                <div className="group-items">
                  {items.map((it) => (
                    <NavLink key={it.to} to={it.to} end={it.end} title={it.label}>
                      <span className="ico">{it.icon}</span>
                      <span className="lbl">{it.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="userbox">
          <div className="name">{user?.fullName}</div>
          <div className="role">{user?.role}</div>
          <button className="secondary" onClick={onLogout} title="Logout">Logout</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <FeedbackWidget />
    </div>
  );
}
