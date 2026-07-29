import { useEffect, useState } from 'react';
import { api } from '../api';

const ROLES = ['WAREHOUSE_HANDLER', 'DRIVER', 'HUB_MANAGER', 'FINANCE_EXEC', 'CLIENT_ADMIN', 'SYS_ADMIN'];
const blank = { fullName: '', email: '', password: '', role: 'WAREHOUSE_HANDLER', hubId: '', clientId: '' };

export function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    api.listUsers().then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setError(''); setMsg('');
    try {
      await api.createUser({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        role: form.role,
        hubId: form.hubId ? +form.hubId : undefined,
        clientId: form.clientId ? +form.clientId : undefined,
      });
      setMsg(`Created ${form.email}`);
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
          <div><label>Password *</label><input value={form.password} onChange={(e) => set('password', e.target.value)} /></div>
          <div>
            <label>Role</label>
            <select value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div><label>Hub ID (ops)</label><input value={form.hubId} onChange={(e) => set('hubId', e.target.value)} /></div>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
