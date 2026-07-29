import { useEffect, useState } from 'react';
import { api, Client } from '../api';

const REASONS = [
  { v: 'weight_discrepancy', l: 'Weight discrepancy' },
  { v: 'demurrage', l: 'Demurrage / detention' },
  { v: 'rate_correction', l: 'Rate correction' },
  { v: 'billing_error', l: 'Billing error' },
  { v: 'goodwill', l: 'Goodwill' },
  { v: 'other', l: 'Other' },
];

const blank = { clientId: '', kind: 'DEBIT', reason: 'demurrage', subtotal: '', narration: '', shipmentId: '', applyGst: true };

export function Notes() {
  const [clients, setClients] = useState<Client[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    api.listNotes().then(setRows).catch((e) => setError(e.message));
    api.listClients().then(setClients).catch(() => {});
  };
  useEffect(load, []);

  const create = async () => {
    setError(''); setMsg('');
    try {
      const res = await api.createNote({
        clientId: +form.clientId,
        kind: form.kind,
        reason: form.reason,
        subtotal: +form.subtotal,
        narration: form.narration || undefined,
        shipmentId: form.shipmentId ? +form.shipmentId : undefined,
        applyGst: form.applyGst,
      });
      setMsg(`${res.note.kind === 'DEBIT' ? 'Debit' : 'Credit'} note ${res.note.noteNo} raised — new balance ₹${res.newBalance}`);
      setForm({ ...blank });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const cancel = async (id: string) => {
    if (!confirm('Cancel this note and reverse its ledger impact?')) return;
    try { await api.cancelNote(id); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>Debit &amp; Credit Notes</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Raise a note</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
          DEBIT adds to what the client owes (extra charge). CREDIT reduces it (money back). Posts to the client ledger.
        </p>
        <div className="grid cols-3">
          <div>
            <label>Client *</label>
            <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">— select —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.legalName} ({c.accountCode})</option>)}
            </select>
          </div>
          <div>
            <label>Type *</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="DEBIT">DEBIT — charge client</option>
              <option value="CREDIT">CREDIT — refund client</option>
            </select>
          </div>
          <div>
            <label>Reason *</label>
            <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {REASONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </div>
          <div><label>Amount ₹ (pre-GST) *</label><input type="number" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: e.target.value })} /></div>
          <div><label>Shipment ID (optional)</label><input value={form.shipmentId} onChange={(e) => setForm({ ...form, shipmentId: e.target.value })} /></div>
          <div><label>&nbsp;</label><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.applyGst} onChange={(e) => setForm({ ...form, applyGst: e.target.checked })} style={{ width: 'auto' }} /> Apply 18% GST</label></div>
          <div style={{ gridColumn: 'span 3' }}><label>Narration</label><input value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.clientId || !form.subtotal} onClick={create}>Raise note</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Note #</th><th>Type</th><th>Reason</th><th>Subtotal</th><th>GST</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id} style={{ opacity: n.status === 'cancelled' ? 0.5 : 1 }}>
                <td><strong>{n.noteNo}</strong><div className="muted" style={{ fontSize: 11 }}>{n.narration}</div></td>
                <td><span className={`badge ${n.kind === 'DEBIT' ? 'PARTIAL' : 'DELIVERED'}`}>{n.kind}</span></td>
                <td className="muted" style={{ fontSize: 12 }}>{n.reason.replace(/_/g, ' ')}</td>
                <td>₹{Number(n.subtotal).toLocaleString('en-IN')}</td>
                <td>₹{Number(n.tax).toLocaleString('en-IN')}</td>
                <td><strong>₹{Number(n.total).toLocaleString('en-IN')}</strong></td>
                <td>{n.status}</td>
                <td>{n.status !== 'cancelled' && <button className="secondary" onClick={() => cancel(n.id)}>Cancel</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">No notes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
