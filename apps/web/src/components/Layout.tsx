import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { hasFeature, effectiveGrants } from '../rights';
import { api } from '../api';
import { Logo } from './Logo';
import { FeedbackWidget } from './FeedbackWidget';

type Item = { to: string; icon: string; label: string; end?: boolean; show?: boolean };
type Group = { title: string; items: Item[] };

export function Layout() {
  const { user, logout } = useAuth();
  const role = user?.role || '';
  const isAdmin = role === 'ADMIN' || role === 'SYS_ADMIN';            // full access bar user-mgmt/wipe
  const isAdminFin = role === 'FINANCE_EXEC' || isAdmin;
  const isOps = ['HUB_MANAGER', 'DRIVER'].includes(role) || isAdmin;
  const canMaster = role === 'HUB_MANAGER' || isAdmin;
  const isSysAdmin = role === 'SYS_ADMIN';                            // super-admin only (Users/Audit)
  const isSales = role === 'SALES';
  const isClient = role === 'CLIENT_ADMIN';
  const nav = useNavigate();

  // Customers get a focused self-service portal — not the ops/back-office nav.
  const clientGroups: Group[] = [
    { title: 'Overview', items: [
      { to: '/', icon: '📊', label: 'My Dashboard', end: true },
      { to: '/tracker', icon: '🧭', label: 'Track Shipment' },
      { to: '/pincode-search', icon: '📍', label: 'Pincode Search' },
    ] },
    { title: 'My Shipments', items: [
      { to: '/create', icon: '➕', label: 'Book Shipment' },
      { to: '/awb-list', icon: '📝', label: 'My Shipments' },
      { to: '/pickups', icon: '📦', label: 'Schedule Pickup' },
    ] },
    { title: 'Billing', items: [
      { to: '/invoices', icon: '🧾', label: 'My Invoices' },
    ] },
  ];
  const [awb, setAwb] = useState('');
  // Global appointment-delivery notification (all pages, staff only).
  const [appts, setAppts] = useState<any[]>([]);
  const [apptOpen, setApptOpen] = useState(false);
  // #16 — customer remarks awaiting CS (all pages, staff only).
  const [custReqs, setCustReqs] = useState<any[]>([]);
  const [custOpen, setCustOpen] = useState(false);
  const loadCustReqs = () => api.customerRequests().then(setCustReqs).catch(() => {});
  const ackCust = async (awb: string) => { try { await api.ackCustomerRequest(awb); setCustReqs((r) => r.filter((x) => x.awb !== awb)); } catch { /* ignore */ } };
  useEffect(() => {
    if (!user || user.role === 'CLIENT_ADMIN') return;
    api.upcomingAppointments().then(setAppts).catch(() => {});
    loadCustReqs();
  }, [user]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = (d?: string | null) => !!d && String(d).slice(0, 10) === todayStr;
  const apptDay = (d?: string | null) => { if (!d) return '—'; const dt = new Date(d); const p = (n: number) => String(n).padStart(2, '0'); return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`; };
  // Popup fires only ~24h early; on Saturday it also surfaces Sunday/Monday appts (office shut).
  const dueSoon = (d?: string | null) => {
    if (!d) return false;
    const appt = new Date(d); appt.setHours(0, 0, 0, 0);
    const t = new Date(); const dow = t.getDay(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((appt.getTime() - t.getTime()) / 86400000);
    if (diff < 0) return false;
    if (diff <= 1) return true;                 // today or tomorrow
    if (dow === 6 && diff === 2) return true;   // Saturday → Monday
    return false;
  };
  const dueAppts = appts.filter((a) => dueSoon(a.apptDate));
  const dueToday = dueAppts.filter((a) => isToday(a.apptDate)).length;
  const exportAppts = async () => {
    const XLSX = await import('xlsx');
    const head = ['AWB', 'Appt date', 'Customer', 'Consignee', 'Pcs', 'Destination'];
    const rows = dueAppts.map((a: any) => [a.awb, apptDay(a.apptDate), a.customer ?? '', a.consignee ?? '', a.pcs ?? '', a.destination ?? '']);
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Appointments');
    XLSX.writeFile(wb, `appointments-${todayStr}.xlsx`);
  };

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lm.rail') === '1');
  const toggleRail = () => setCollapsed((c) => { const n = !c; localStorage.setItem('lm.rail', n ? '1' : '0'); return n; });

  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('lm.navClosed') || '{}'); } catch { return {}; }
  });
  const toggleGroup = (title: string) => setClosed((c) => {
    const n = { ...c, [title]: !c[title] }; localStorage.setItem('lm.navClosed', JSON.stringify(n)); return n;
  });

  // Appearance — skin (aurora | calm) × theme (light | dark), remembered per browser.
  // Applied to <html> so the token blocks in styles.css win; a bootstrap script in
  // index.html sets the same attributes pre-paint to avoid a flash.
  const [skin, setSkin] = useState(() => localStorage.getItem('lm.skin') || 'aurora');
  const [theme, setTheme] = useState(() => localStorage.getItem('lm.theme') || 'light');
  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute('data-skin', skin); r.setAttribute('data-theme', theme);
    localStorage.setItem('lm.skin', skin); localStorage.setItem('lm.theme', theme);
  }, [skin, theme]);

  const groups: Group[] = isClient ? clientGroups : [
    { title: 'Overview', items: [
      { to: '/', icon: '📊', label: 'Dashboard', end: true },
      { to: '/team-dashboards', icon: '📈', label: 'Team Dashboards' },
      { to: '/tracker', icon: '🧭', label: 'Track Shipment' },
      { to: '/pincode-search', icon: '📍', label: 'Pincode Search' },
    ] },
    { title: 'Operations', items: [
      { to: '/create', icon: '➕', label: 'New Shipment' },
      { to: '/awb-list', icon: '📝', label: 'Shipment List' },
      { to: '/bulk', icon: '📥', label: 'Bulk Booking' },
      { to: '/walk-in', icon: '🧾', label: 'Walk-in Counter', show: isAdminFin || canMaster },
      { to: '/deliver', icon: '🚚', label: 'Delivery App', show: isOps },
      { to: '/pickups', icon: '📦', label: 'Pickups' },
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
      { to: '/sales-mis', icon: '📈', label: 'Sales MIS', show: isAdminFin || isSales },
      { to: '/receivables', icon: '📒', label: 'Receivables', show: isAdminFin },
      { to: '/notes', icon: '±', label: 'Debit / Credit Notes', show: isAdminFin },
      { to: '/claims', icon: '🛡', label: 'Claims', show: isAdminFin },
      { to: '/customers', icon: '👥', label: 'Customers', show: isAdminFin || isSales },
      { to: '/vendors', icon: '🏢', label: 'Vendors', show: isAdminFin },
      { to: '/vehicles', icon: '🚚', label: 'Vehicles', show: isAdminFin },
      { to: '/vendor-bills', icon: '🚚', label: 'Vendor Bills & P&L', show: isAdminFin },
      { to: '/expenses', icon: '💸', label: 'Expense Tracker', show: isAdminFin },
      { to: '/documents', icon: '📁', label: 'Documents', show: isAdminFin },
      { to: '/sales', icon: '📈', label: 'Sales', show: isAdminFin || isSales },
    ] },
    { title: 'Masters & Setup', items: [
      { to: '/ftl-rates', icon: '🚛', label: 'FTL Rates', show: isAdminFin },
      { to: '/per-box-rates', icon: '📦', label: 'Per-Box Rates', show: isAdminFin },
      { to: '/service-mapping', icon: '🔀', label: 'Service Mapping', show: canMaster },
      { to: '/pincodes', icon: '📍', label: 'Pincodes and TAT', show: canMaster },
      { to: '/masters', icon: '🗃', label: 'Masters', show: canMaster },
      { to: '/bulk-rate-upload', icon: '⬆', label: 'Bulk Rate Upload', show: canMaster },
      { to: '/tax', icon: '🧮', label: 'Tax Filing', show: isAdminFin },
    ] },
    { title: 'Insights & Admin', items: [
      { to: '/reports', icon: '📈', label: 'Reports', show: isAdminFin || canMaster },
      { to: '/riders', icon: '🛵', label: 'Riders & Drivers', show: canMaster },
      { to: '/users', icon: '⚙️', label: 'Users', show: isSysAdmin },
      { to: '/bluedart', icon: '🚚', label: 'Carrier APIs', show: isSysAdmin },
      { to: '/audit', icon: '🕵', label: 'Audit Log', show: isSysAdmin },
      { to: '/feedback', icon: '💬', label: 'Feedback', show: isSysAdmin },
    ] },
    { title: 'Utilities', items: [
      { to: '/archive', icon: '🗄', label: 'Archive', show: isSysAdmin },
    ] },
  ];

  const onLogout = () => { logout(); nav('/login'); };
  const lookupAwb = (e: React.FormEvent) => {
    e.preventDefault();
    const q = awb.trim();
    if (!q) return;
    nav(`/tracker/${encodeURIComponent(q)}`);
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
            // Visibility precedence (see rights.ts): explicit per-user grants → the user's
            // DEPARTMENT default feature map → role defaults. Super/client admins are role-driven
            // (effectiveGrants returns null for them). Server-side RBAC remains the real boundary.
            const grants = effectiveGrants(user as any);
            const items = g.items.filter((it) => (grants ? hasFeature(grants, it.to) : it.show !== false));
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
          {!collapsed && (
            <div className="appearance">
              <div className="skin-seg">
                <button className={skin === 'aurora' ? 'on' : ''} onClick={() => setSkin('aurora')} title="Aurora theme">Aurora</button>
                <button className={skin === 'calm' ? 'on' : ''} onClick={() => setSkin('calm')} title="Calm theme">Calm</button>
              </div>
              <button className="mode-toggle" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Toggle light / dark">
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
            </div>
          )}
          <div className="name">{user?.fullName}</div>
          <div className="role">{user?.role}</div>
          <button className="secondary" onClick={onLogout} title="Logout">Logout</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>

      {/* Global appointment-delivery notification — visible on every page. */}
      {!isClient && dueAppts.length > 0 && (
        <div style={{ position: 'fixed', top: 14, right: 18, zIndex: 1200 }}>
          <button onClick={() => setApptOpen((o) => !o)} title="Appointment deliveries due"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,.15)', background: dueToday ? 'var(--danger, #c0392b)' : 'var(--brand)', color: '#fff', border: 'none' }}>
            📅 {dueAppts.length} appt{dueAppts.length > 1 ? 's' : ''} due{dueToday ? ` · ${dueToday} today` : ''}
          </button>
          {apptOpen && (
            <div style={{ position: 'absolute', right: 0, top: 44, width: 380, maxHeight: 440, overflowY: 'auto', background: 'var(--surface, #fff)', border: '1px solid var(--line, #d7dadf)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.18)', padding: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 14 }}>📅 Appointments due (24h)</strong>
                <div className="row" style={{ gap: 6 }}>
                  <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={exportAppts} title="Export to Excel (AWB, customer, pcs, consignee)">⬇ Excel</button>
                  <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setApptOpen(false)}>✕</button>
                </div>
              </div>
              {dueAppts.map((a: any) => (
                <div key={a.awb} onClick={() => { setApptOpen(false); nav(`/tracker/${a.awb}`); }}
                  style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, background: isToday(a.apptDate) ? 'var(--surface-2, #f1f3f6)' : 'transparent', borderLeft: isToday(a.apptDate) ? '3px solid var(--danger, #c0392b)' : '3px solid transparent' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{apptDay(a.apptDate)}{isToday(a.apptDate) ? ' · TODAY' : ''} <span className="muted" style={{ fontWeight: 500 }}>· {a.awb}</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{a.customer || a.consignee || '—'}{a.accountCode ? ` (${a.accountCode})` : ''}{a.pcs ? ` · ${a.pcs} pcs` : ''} → {a.destination || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isClient && custReqs.length > 0 && (
        <div style={{ position: 'fixed', top: dueAppts.length > 0 ? 56 : 14, right: 18, zIndex: 1199 }}>
          <button onClick={() => setCustOpen((o) => !o)} title="Customer remarks awaiting CS"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,.15)', background: 'var(--warn, #d97706)', color: '#fff', border: 'none' }}>
            📣 {custReqs.length} customer note{custReqs.length > 1 ? 's' : ''}
          </button>
          {custOpen && (
            <div style={{ position: 'absolute', right: 0, top: 44, width: 400, maxHeight: 460, overflowY: 'auto', background: 'var(--surface, #fff)', border: '1px solid var(--line, #d7dadf)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.18)', padding: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 14 }}>📣 Customer remarks for CS</strong>
                <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setCustOpen(false)}>✕</button>
              </div>
              {custReqs.map((c: any) => (
                <div key={c.awb} style={{ padding: '8px 10px', borderRadius: 8, marginBottom: 4, borderLeft: '3px solid var(--warn, #d97706)', background: 'var(--surface-2, #f1f3f6)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => { setCustOpen(false); nav(`/tracker/${c.awb}`); }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.awb} <span className="muted" style={{ fontWeight: 500 }}>· {c.customer || c.consignee || '—'}{c.accountCode ? ` (${c.accountCode})` : ''}</span></div>
                      <div style={{ fontSize: 12.5, margin: '2px 0' }}>“{c.remark}”</div>
                      <div className="muted" style={{ fontSize: 11 }}>{c.remarkAt ? new Date(c.remarkAt).toLocaleString('en-GB') : ''}{c.apptDate ? ` · 📅 appt ${apptDay(c.apptDate)}` : ''} · {c.statusCode}</div>
                    </div>
                    <button className="secondary" style={{ padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }} title="Mark handled" onClick={() => ackCust(c.awb)}>✓ Done</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <FeedbackWidget />
    </div>
  );
}
