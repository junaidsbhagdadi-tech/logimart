import { useEffect, useState } from 'react';
import { api } from '../api';

const ACTION_BADGE: Record<string, string> = { create: 'DELIVERED', update: 'PARTIAL', delete: 'EXCEPTION' };

export function AuditLog() {
  const [rows, setRows] = useState<any[]>([]);
  const [entity, setEntity] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    api.auditLog({ entity: entity || undefined, limit: 300 }).then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, [entity]);

  const entities = [...new Set(rows.map((r) => r.entity).filter(Boolean))];

  return (
    <>
      <h1>Audit Log</h1>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Every create / update / delete across the system, most recent first.</p>
          <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All entities</option>
            {entities.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <table>
          <thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Path</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ fontSize: 12 }}>{new Date(r.createdAt).toLocaleString('en-IN')}</td>
                <td>{r.userName ?? '—'}</td>
                <td className="muted" style={{ fontSize: 11 }}>{r.role ?? '—'}</td>
                <td><span className={`badge ${ACTION_BADGE[r.action] ?? ''}`}>{r.action}</span></td>
                <td>{r.entity ?? '—'}{r.entityId ? <span className="muted"> #{r.entityId}</span> : ''}</td>
                <td className="muted" style={{ fontSize: 11 }}>{r.method} {r.path}</td>
                <td style={{ color: r.status >= 400 ? 'var(--danger, #b91c1c)' : 'inherit' }}>{r.status}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No activity recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
