import { useEffect, useState } from 'react';
import { api } from '../api';

export function Feedback() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');

  const load = () => { api.listFeedback().then(setRows).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const review = async (id: string) => {
    try { await api.reviewFeedback(id); load(); } catch (e: any) { setError(e.message); }
  };

  const open = rows.filter((r) => r.status === 'open').length;

  return (
    <>
      <h1>Feedback inbox</h1>
      {error && <div className="error">{error}</div>}
      <p className="muted">{rows.length} total · {open} open</p>

      <div className="card">
        <table>
          <thead><tr><th>When</th><th>From</th><th>Type</th><th>Rating</th><th>Page</th><th>Message</th><th></th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} style={{ opacity: f.status === 'reviewed' ? 0.55 : 1 }}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(f.createdAt).toLocaleString()}</td>
                <td>{f.userName}<div className="muted" style={{ fontSize: 11 }}>{f.role}</div></td>
                <td><span className="badge CREATED">{f.category ?? '—'}</span></td>
                <td>{f.rating ? '★'.repeat(f.rating) : '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{f.page ?? '—'}</td>
                <td>{f.message}</td>
                <td>{f.status === 'open' ? <button className="secondary" onClick={() => review(f.id)}>Mark reviewed</button> : <span className="badge DELIVERED">reviewed</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No feedback yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
