import { useEffect, useState } from 'react';
import { api } from '../api';

const TYPES = ['damage', 'loss', 'shortage', 'delay'];
const STATUS_BADGE: Record<string, string> = {
  open: 'PARTIAL', under_review: 'PARTIAL', approved: 'DELIVERED',
  settled: 'DELIVERED', rejected: 'EXCEPTION', closed: '',
};

const blank = { awb: '', type: 'damage', claimedAmount: '', declaredValue: '', description: '' };

export function Claims() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => { api.listClaims().then(setRows).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const create = async () => {
    setError(''); setMsg('');
    try {
      const c = await api.createClaim({
        awb: form.awb || undefined,
        type: form.type,
        claimedAmount: +form.claimedAmount,
        declaredValue: form.declaredValue ? +form.declaredValue : undefined,
        description: form.description || undefined,
      });
      setMsg(`Claim ${c.claimNo} logged`);
      setForm({ ...blank });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const review = async (id: string, status: 'under_review' | 'rejected') => {
    const resolution = status === 'rejected' ? prompt('Rejection reason:') || undefined : undefined;
    try { await api.reviewClaim(id, { status, resolution }); load(); } catch (e: any) { setError(e.message); }
  };
  const settle = async (id: string) => {
    const amt = prompt('Approved settlement amount ₹ (raises a credit note):');
    if (!amt) return;
    try { await api.settleClaim(id, { approvedAmount: +amt }); setMsg('Claim settled — credit note raised'); load(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Claims &amp; Insurance</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Log a claim</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Enter an AWB to auto-link the client &amp; declared value. Settlement raises a credit note to the client.</p>
        <div className="grid cols-3">
          <div><label>AWB</label><input value={form.awb} onChange={(e) => setForm({ ...form, awb: e.target.value })} placeholder="LMT2026…" /></div>
          <div>
            <label>Type *</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label>Claimed amount ₹ *</label><input type="number" value={form.claimedAmount} onChange={(e) => setForm({ ...form, claimedAmount: e.target.value })} /></div>
          <div><label>Declared value ₹</label><input type="number" value={form.declaredValue} onChange={(e) => setForm({ ...form, declaredValue: e.target.value })} /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Description</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.claimedAmount} onClick={create}>Log claim</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Claim #</th><th>AWB</th><th>Type</th><th>Claimed</th><th>Approved</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.claimNo}</strong><div className="muted" style={{ fontSize: 11 }}>{c.description}</div></td>
                <td>{c.awb ?? '—'}</td>
                <td>{c.type}</td>
                <td>₹{Number(c.claimedAmount).toLocaleString('en-IN')}</td>
                <td>{c.approvedAmount != null ? `₹${Number(c.approvedAmount).toLocaleString('en-IN')}` : '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[c.status] ?? ''}`}>{c.status.replace(/_/g, ' ')}</span></td>
                <td>
                  {!['settled', 'rejected', 'closed'].includes(c.status) && (
                    <div className="row" style={{ gap: 6 }}>
                      {c.status === 'open' && <button className="secondary" onClick={() => review(c.id, 'under_review')}>Review</button>}
                      <button onClick={() => settle(c.id)}>Settle</button>
                      <button className="secondary" onClick={() => review(c.id, 'rejected')}>Reject</button>
                    </div>
                  )}
                  {c.status === 'settled' && <span className="muted" style={{ fontSize: 11 }}>{c.resolution}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No claims yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
