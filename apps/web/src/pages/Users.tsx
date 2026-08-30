import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { FEATURE_CATALOG } from '../features';

const ROLES = ['SYS_ADMIN', 'ADMIN', 'FINANCE_EXEC', 'SALES', 'HUB_MANAGER', 'WAREHOUSE_HANDLER', 'DRIVER', 'CLIENT_ADMIN'];
// Friendly labels shown in the dropdowns (enum value stays the same on the wire).
const ROLE_LABELS: Record<string, string> = {
  SYS_ADMIN: 'Super Admin', ADMIN: 'Admin', FINANCE_EXEC: 'Finance', SALES: 'Sales',
  HUB_MANAGER: 'Ops (Hub Manager)', WAREHOUSE_HANDLER: 'Warehouse', DRIVER: 'Driver', CLIENT_ADMIN: 'Customer',
};
const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;
const blank = { fullName: '', email: '', password: '', role: 'WAREHOUSE_HANDLER', hubId: '', clientId: '' };

export function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [grantUser, setGrantUser] = useState<any | null>(null);
  const [grants, setGrants] = useState<Record<string, 'VIEW' | 'EDIT' | 'DELETE'>>({});
  const [hubs, setHubs] = useState<{ id: string; code: string; name: string }[]>([]);
  const [cred, setCred] = useState<{ email: string; password: string; url: string; heading: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const credText = (c: { email: string; password: string; url: string }) =>
    `ExcelEx Express login\nURL: ${c.url}\nEmail: ${c.email}\nTemporary password: ${c.password}\nPlease sign in and change your password.`;
  const copyCred = async () => {
    if (!cred) return;
    try { await navigator.clipboard.writeText(credText(cred)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked — the text is visible to copy manually */ }
  };

  const load = () => {
    api.listUsers().then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  useEffect(() => { api.listHubs().then(setHubs).catch(() => {}); }, []);

  // Grants can arrive as a legacy string[] (each = full/DELETE) or a { to: level } map.
  const openGrants = (u: any) => {
    setGrantUser(u);
    const g = u.featureGrants;
    const m: Record<string, 'VIEW' | 'EDIT' | 'DELETE'> = {};
    if (Array.isArray(g)) g.forEach((k: string) => { m[k] = 'DELETE'; });
    else if (g && typeof g === 'object') for (const [k, v] of Object.entries(g)) { const lv = String(v).toUpperCase(); if (['VIEW', 'EDIT', 'DELETE'].includes(lv)) m[k] = lv as any; }
    setGrants(m);
  };
  const setGrant = (to: string, level: '' | 'VIEW' | 'EDIT' | 'DELETE') => setGrants((g) => { const n = { ...g }; if (!level) delete n[to]; else n[to] = level; return n; });
  const saveGrants = async (clear = false) => {
    if (!grantUser) return;
    try { await api.updateUser(grantUser.id, { featureGrants: clear ? null : grants }); setMsg(clear ? 'Reset to role defaults' : `Features updated for ${grantUser.fullName}`); setGrantUser(null); load(); }
    catch (e: any) { setError(e.message); }
  };

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setError(''); setMsg(''); setCred(null);
    try {
      const res: any = await api.createUser({
        fullName: form.fullName,
        email: form.email,
        password: form.password || undefined,
        role: form.role,
        hubId: form.hubId ? +form.hubId : undefined,
        clientId: form.clientId ? +form.clientId : undefined,
      });
      if (res?.tempPassword) {
        setCred({ email: res.email ?? form.email, password: res.tempPassword, url: res.loginUrl ?? window.location.origin, heading: `Account created — ${form.email}` });
      } else {
        setMsg(`✓ Created ${form.email}. Login credentials emailed to ${form.email}.`);
      }
      setForm({ ...blank });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const toggle = async (u: any) => {
    try { await api.updateUser(u.id, { isActive: !u.isActive }); load(); } catch (e: any) { setError(e.message); }
  };
  const changeRole = async (u: any, role: string) => {
    try { await api.updateUser(u.id, { role }); load(); } catch (e: any) { setError(e.message); }
  };
  const resetPwd = async (u: any) => {
    setError(''); setMsg(''); setCred(null);
    const pw = prompt(`New password for ${u.email}:\n\nLeave blank and press OK to auto-generate a temporary password (it'll be shown here + emailed).`);
    if (pw === null) return; // cancelled
    try {
      if (pw.trim()) {
        await api.updateUser(u.id, { password: pw.trim() });
        setCred({ email: u.email, password: pw.trim(), url: window.location.origin, heading: `Password reset — ${u.email}` });
      } else {
        const res = await api.resetUserPassword(u.id);
        setCred({ email: res.email, password: res.tempPassword, url: res.loginUrl, heading: `Password reset — ${res.email}` });
      }
    } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Users &amp; Roles</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}
      {cred && (
        <div className="card" style={{ borderLeft: '4px solid var(--brand)', background: 'var(--surface, #fff)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <strong>🔐 {cred.heading}</strong>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={copyCred}>{copied ? '✓ Copied' : '📋 Copy credentials'}</button>
              <button className="secondary" onClick={() => setCred(null)}>Dismiss</button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
            Credentials emailed to the client (queued until an email provider is live). Copy and share them manually meanwhile — this is shown once.
          </p>
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg, #f0f2f4)', borderRadius: 8, fontSize: 13, whiteSpace: 'pre-wrap' }}>{credText(cred)}</pre>
        </div>
      )}

      <div className="card">
        <h2>Create user</h2>
        <div className="grid cols-3">
          <div><label>Full name *</label><input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} /></div>
          <div><label>Email *</label><input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div><label>Password <span className="muted">(blank = auto-generate + email)</span></label><input value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="leave blank to auto-generate" /></div>
          <div>
            <label>Role</label>
            <select value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div><label>Home hub (ops — scopes their scans)</label>
            <select value={form.hubId} onChange={(e) => set('hubId', e.target.value)}>
              <option value="">— none (all hubs) —</option>
              {hubs.map((h) => <option key={h.id} value={h.id}>{h.code} — {h.name}</option>)}
            </select>
          </div>
          <div><label>Client ID (client admin)</label><input value={form.clientId} onChange={(e) => set('clientId', e.target.value)} /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.fullName || !form.email} onClick={create}>Create user</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.fullName}</strong></td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} style={{ width: 'auto' }}>
                    {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </td>
                <td><span className={`badge ${u.isActive ? 'DELIVERED' : 'CANCELLED'}`}>{u.isActive ? 'ACTIVE' : 'DISABLED'}</span></td>
                <td className="row" style={{ gap: 6 }}>
                  <button className="secondary" onClick={() => toggle(u)}>{u.isActive ? 'Disable' : 'Enable'}</button>
                  <button className="secondary" onClick={() => resetPwd(u)}>Reset pwd</button>
                  {u.role !== 'SYS_ADMIN' && <button className="secondary" onClick={() => openGrants(u)} title="Assign feature access">🔑 Features{u.featureGrants ? ` (${Array.isArray(u.featureGrants) ? u.featureGrants.length : Object.keys(u.featureGrants).length})` : ''}</button>}
                  <button className="secondary" title="Delete user" onClick={async () => { if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return; try { await api.deleteUser(u.id); setMsg(`Deleted ${u.email}`); load(); } catch (e: any) { setError(e.message); } }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {grantUser && <Modal title={`Feature access — ${grantUser.fullName}`} width={720} onClose={() => setGrantUser(null)}>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Set each feature's access level: <b>None</b> hides it, <b>View</b> = read-only, <b>Edit</b> = create/update, <b>Delete</b> = full including delete. Empty + <em>Save</em> hides everything; <em>Reset to role defaults</em> reverts to the role's standard full access. (Role-based server permissions remain the security boundary; levels are enforced in the UI.)</p>
        <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
          {FEATURE_CATALOG.map((sec) => (
            <div key={sec.section} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.3px' }}>{sec.section.toUpperCase()}</strong>
                <div className="row" style={{ gap: 4 }}>
                  <button className="secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setGrants((g) => { const n = { ...g }; sec.features.forEach((f) => { n[f.to] = 'DELETE'; }); return n; })}>all: full</button>
                  <button className="secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setGrants((g) => { const n = { ...g }; sec.features.forEach((f) => { n[f.to] = 'VIEW'; }); return n; })}>all: view</button>
                  <button className="secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setGrants((g) => { const n = { ...g }; sec.features.forEach((f) => { delete n[f.to]; }); return n; })}>none</button>
                </div>
              </div>
              <div className="grid cols-2" style={{ gap: 4, marginTop: 4 }}>
                {sec.features.map((f) => (
                  <div key={f.to} className="row" style={{ gap: 6, alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0' }}>
                    <span>{f.label}</span>
                    <select value={grants[f.to] ?? ''} onChange={(e) => setGrant(f.to, e.target.value as any)} style={{ padding: '2px 6px', fontSize: 12, maxWidth: 110 }}>
                      <option value="">None</option>
                      <option value="VIEW">View</option>
                      <option value="EDIT">Edit</option>
                      <option value="DELETE">Delete</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
          <button className="secondary" onClick={() => saveGrants(true)}>↺ Reset to role defaults</button>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" onClick={() => setGrantUser(null)}>Cancel</button>
            <button onClick={() => saveGrants(false)}>Save features ({Object.keys(grants).length})</button>
          </div>
        </div>
      </Modal>}
    </>
  );
}
