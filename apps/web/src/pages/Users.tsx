import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { FEATURE_CATALOG } from '../features';

const ROLES = ['WAREHOUSE_HANDLER', 'DRIVER', 'HUB_MANAGER', 'FINANCE_EXEC', 'CLIENT_ADMIN', 'SYS_ADMIN'];
const blank = { fullName: '', email: '', password: '', role: 'WAREHOUSE_HANDLER', hubId: '', clientId: '' };

export function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [grantUser, setGrantUser] = useState<any | null>(null);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [hubs, setHubs] = useState<{ id: string; code: string; name: string }[]>([]);

  const load = () => {
    api.listUsers().then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  useEffect(() => { api.listHubs().then(setHubs).catch(() => {}); }, []);

  const openGrants = (u: any) => { setGrantUser(u); setGrants(new Set(Array.isArray(u.featureGrants) ? u.featureGrants : [])); };
  const toggleGrant = (to: string) => setGrants((g) => { const n = new Set(g); n.has(to) ? n.delete(to) : n.add(to); return n; });
  const saveGrants = async (clear = false) => {
    if (!grantUser) return;
    try { await api.updateUser(grantUser.id, { featureGrants: clear ? null : [...grants] }); setMsg(clear ? 'Reset to role defaults' : `Features updated for ${grantUser.fullName}`); setGrantUser(null); load(); }
    catch (e: any) { setError(e.message); }
  };

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setError(''); setMsg('');
    try {
      const res: any = await api.createUser({
        fullName: form.fullName,
        email: form.email,
        password: form.password || undefined,
        role: form.role,
        hubId: form.hubId ? +form.hubId : undefined,
        clientId: form.clientId ? +form.clientId : undefined,
      });
      setMsg(res?.tempPassword
        ? `✓ Created ${form.email}. Credentials emailed. Temporary password: ${res.tempPassword} (share it until email is live).`
        : `✓ Created ${form.email}. Login credentials emailed to ${form.email}.`);
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
    const pw = prompt(`New password for ${u.email}:`);
    if (!pw) return;
    try { await api.updateUser(u.id, { password: pw }); setMsg('Password reset'); } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Users &amp; Roles</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Create user</h2>
        <div className="grid cols-3">
          <div><label>Full name *</label><input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} /></div>
          <div><label>Email *</label><input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div><label>Password <span className="muted">(blank = auto-generate + email)</span></label><input value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="leave blank to auto-generate" /></div>
          <div>
            <label>Role</label>
            <select value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
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
        <button style={{ marginTop: 12 }} disabled={!form.fullName || !form.email || !form.password} onClick={create}>Create user</button>
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
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td><span className={`badge ${u.isActive ? 'DELIVERED' : 'CANCELLED'}`}>{u.isActive ? 'ACTIVE' : 'DISABLED'}</span></td>
                <td className="row" style={{ gap: 6 }}>
                  <button className="secondary" onClick={() => toggle(u)}>{u.isActive ? 'Disable' : 'Enable'}</button>
                  <button className="secondary" onClick={() => resetPwd(u)}>Reset pwd</button>
                  {u.role !== 'SYS_ADMIN' && <button className="secondary" onClick={() => openGrants(u)} title="Assign feature access">🔑 Features{Array.isArray(u.featureGrants) ? ` (${u.featureGrants.length})` : ''}</button>}
                  <button className="secondary" title="Delete user" onClick={async () => { if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return; try { await api.deleteUser(u.id); setMsg(`Deleted ${u.email}`); load(); } catch (e: any) { setError(e.message); } }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {grantUser && <Modal title={`Feature access — ${grantUser.fullName}`} width={720} onClose={() => setGrantUser(null)}>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Tick the features this user can access in the sidebar. Empty + <em>Save</em> hides everything; <em>Reset to role defaults</em> reverts to their role's standard access. (Role-based server permissions still apply as the security boundary.)</p>
        <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
          {FEATURE_CATALOG.map((sec) => (
            <div key={sec.section} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.3px' }}>{sec.section.toUpperCase()}</strong>
                <button className="secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setGrants((g) => { const n = new Set(g); const all = sec.features.every((f) => n.has(f.to)); sec.features.forEach((f) => all ? n.delete(f.to) : n.add(f.to)); return n; })}>toggle all</button>
              </div>
              <div className="grid cols-3" style={{ gap: 4, marginTop: 4 }}>
                {sec.features.map((f) => (
                  <label key={f.to} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={grants.has(f.to)} onChange={() => toggleGrant(f.to)} /> {f.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
          <button className="secondary" onClick={() => saveGrants(true)}>↺ Reset to role defaults</button>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" onClick={() => setGrantUser(null)}>Cancel</button>
            <button onClick={() => saveGrants(false)}>Save features ({grants.size})</button>
          </div>
        </div>
      </Modal>}
    </>
  );
}
