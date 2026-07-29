import { useEffect, useState } from 'react';
import { api } from '../api';

const STAGES = ['NEW', 'MEETING', 'QUOTED', 'WON', 'LOST'];
const SERVICES = ['FTL', 'PTL', 'AIR', 'TRAIN'];
const blank = {
  companyName: '', contactName: '', phone: '', email: '', salesperson: '',
  services: [] as string[], potentialVolume: '', potentialRevenue: '', nextFollowup: '', notes: '',
};

export function Sales() {
  const [leads, setLeads] = useState<any[]>([]);
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    api.listLeads().then(setLeads).catch((e) => setError(e.message));
    api.leadPipeline().then(setPipeline).catch(() => {});
  };
  useEffect(load, []);

  const toggleSvc = (s: string) =>
    setForm((f) => ({ ...f, services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s] }));

  const create = async () => {
    setError(''); setMsg('');
    try {
      await api.createLead({
        ...form,
        potentialRevenue: form.potentialRevenue ? +form.potentialRevenue : undefined,
        nextFollowup: form.nextFollowup || undefined,
      });
      setMsg('Prospect added'); setForm({ ...blank }); load();
    } catch (e: any) { setError(e.message); }
  };

  const setStage = async (id: string, stage: string) => {
    try { await api.updateLead(id, { stage }); load(); } catch (e: any) { setError(e.message); }
  };
  const addQuote = async (id: string) => {
    const service = prompt('Service (FTL/PTL/AIR/TRAIN):', 'FTL'); if (!service) return;
    const amount = prompt('Quoted amount ₹:'); if (!amount) return;
    const lane = prompt('Lane (e.g. Bengaluru → Chennai):') || undefined;
    try { await api.addQuotation(id, { service, amount: +amount, lane }); setMsg('Quotation added'); load(); }
    catch (e: any) { setError(e.message); }
  };

  const stageCount = (s: string) => pipeline.find((p) => p.stage === s)?.count ?? 0;

  const today = new Date().toISOString().slice(0, 10);
  const followups = leads
    .filter((l) => l.nextFollowup && l.stage !== 'WON' && l.stage !== 'LOST')
    .sort((a, b) => String(a.nextFollowup).localeCompare(String(b.nextFollowup)));
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  return (
    <>
      <h1>Sales Pipeline</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        {STAGES.map((s) => (
          <div key={s} className="card kpi" style={{ flex: 1, minWidth: 120 }}>
            <div className="muted" style={{ fontSize: 12 }}>{s}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy)' }}>{stageCount(s)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Follow-ups &amp; meetings</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Prospects with a scheduled next touch-point. Overdue items are flagged.</p>
        <table>
          <thead><tr><th>When</th><th>Company</th><th>Contact</th><th>Salesperson</th><th>Stage</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {followups.map((l) => {
              const overdue = String(l.nextFollowup).slice(0, 10) < today;
              return (
                <tr key={l.id}>
                  <td>
                    <span className={`badge ${overdue ? 'PARTIAL' : 'DELIVERED'}`}>{fmtDate(l.nextFollowup)}</span>
                    {overdue && <div className="muted" style={{ fontSize: 10 }}>overdue</div>}
                  </td>
                  <td><strong>{l.companyName}</strong></td>
                  <td>{l.contactName ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{l.phone}</div></td>
                  <td>{l.salesperson ?? '—'}</td>
                  <td><span className="badge">{l.stage}</span></td>
                  <td className="muted" style={{ fontSize: 12 }}>{l.notes ?? '—'}</td>
                  <td><button className="secondary" onClick={() => addQuote(l.id)}>+ Quote</button></td>
                </tr>
              );
            })}
            {followups.length === 0 && <tr><td colSpan={7} className="muted">No upcoming follow-ups. Set a “Next follow-up” date when adding a prospect below.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Add prospect</h2>
        <div className="grid cols-3">
          <div><label>Company *</label><input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></div>
          <div><label>Contact</label><input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
          <div><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label>Salesperson</label><input value={form.salesperson} onChange={(e) => setForm({ ...form, salesperson: e.target.value })} /></div>
          <div><label>Next follow-up</label><input type="date" value={form.nextFollowup} onChange={(e) => setForm({ ...form, nextFollowup: e.target.value })} /></div>
          <div><label>Potential volume</label><input value={form.potentialVolume} onChange={(e) => setForm({ ...form, potentialVolume: e.target.value })} placeholder="e.g. 20 trucks/mo" /></div>
          <div><label>Potential revenue ₹/mo</label><input type="number" value={form.potentialRevenue} onChange={(e) => setForm({ ...form, potentialRevenue: e.target.value })} /></div>
          <div>
            <label>Services of interest</label>
            <div className="row" style={{ gap: 12 }}>
              {SERVICES.map((s) => (
                <label key={s} className="row" style={{ gap: 5 }}><input type="checkbox" checked={form.services.includes(s)} onChange={() => toggleSvc(s)} style={{ width: 'auto' }} /> {s}</label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: 'span 3' }}><label>Notes (1st meeting, etc.)</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!form.companyName} onClick={create}>Add prospect</button>
      </div>

      <div className="card">
        <h2>All prospects</h2>
        <table>
          <thead><tr><th>Company</th><th>Contact</th><th>Salesperson</th><th>Services</th><th>Potential</th><th>Stage</th><th>Quotes</th><th></th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.companyName}</strong></td>
                <td>{l.contactName ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{l.phone}</div></td>
                <td>{l.salesperson ?? '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{l.services ?? '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{l.potentialVolume ?? ''} {l.potentialRevenue ? `· ₹${Number(l.potentialRevenue).toLocaleString('en-IN')}/mo` : ''}</td>
                <td>
                  <select value={l.stage} onChange={(e) => setStage(l.id, e.target.value)} style={{ width: 'auto' }}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>{l.quotations?.length ?? 0}</td>
                <td><button className="secondary" onClick={() => addQuote(l.id)}>+ Quote</button></td>
              </tr>
            ))}
            {leads.length === 0 && <tr><td colSpan={8} className="muted">No prospects yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
