import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';

// Monthly deduction detail — columns mirror the ops sheet. req = mandatory, else optional.
const COLS: { key: string; label: string; req: boolean; date?: boolean; num?: boolean }[] = [
  { key: 'awb', label: 'AWB no', req: true },
  { key: 'vendorName', label: 'Vendor name', req: true },
  { key: 'vendorAcCode', label: 'Vendor A/c code', req: true },
  { key: 'pickupDate', label: 'Pickup date', req: true, date: true },
  { key: 'deliveryDate', label: 'Delivery date', req: false, date: true },
  { key: 'emailCommDate', label: 'Email communication date', req: true, date: true },
  { key: 'madeToNames', label: 'Made to (Names)', req: true },
  { key: 'reason', label: 'Reason for deduction', req: true },
  { key: 'amount', label: 'Deduction amount', req: true, num: true },
  { key: 'attachment', label: 'Attach Pic / email comm', req: true },
  { key: 'customerCode', label: 'Customer Code', req: true },
  { key: 'approvedAmount', label: 'Approved amount (vendor)', req: false, num: true },
  { key: 'status', label: 'Claim status', req: false },
  { key: 'remark', label: 'Remark', req: false },
];
const STATUS_OPTS = ['ongoing', 'closed', 'rejected', 'disputed'];
const blank: Record<string, string> = Object.fromEntries(COLS.map((c) => [c.key, '']));
const d10 = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '');
const cell = (r: any, c: { key: string; date?: boolean; num?: boolean }) =>
  c.date ? d10(r[c.key]) : c.num ? (r[c.key] != null ? Number(r[c.key]).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '') : (r[c.key] ?? '');

const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function Deductions() {
  const [rows, setRows] = useState<any[]>([]);
  const [month, setMonth] = useState(''); // '' = all months
  const [form, setForm] = useState({ ...blank });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => { api.listDeductions(month || undefined).then(setRows).catch((e) => setError(e.message)); };
  useEffect(load, [month]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const missing = COLS.filter((c) => c.req && !String(form[c.key] ?? '').trim()).map((c) => c.label);
  const [lookupMsg, setLookupMsg] = useState('');

  // Auto-fill vendor / customer / dates from the AWB.
  const fetchAwb = async (awbRaw: string) => {
    const awb = String(awbRaw || '').trim();
    if (!awb) return;
    setLookupMsg('Looking up…');
    try {
      const r = await api.deductionAwbLookup(awb);
      if (!r) { setLookupMsg('AWB not found — enter details manually.'); return; }
      setForm((f) => ({
        ...f,
        awb: r.awb,
        vendorName: r.vendorName || f.vendorName,
        vendorAcCode: r.vendorAcCode || f.vendorAcCode,
        customerCode: r.customerCode || f.customerCode,
        pickupDate: r.pickupDate || f.pickupDate,
        deliveryDate: r.deliveryDate || f.deliveryDate,
      }));
      setLookupMsg('✓ Auto-filled from AWB');
    } catch { setLookupMsg('Lookup failed — enter details manually.'); }
  };

  const save = async () => {
    setError(''); setMsg('');
    if (missing.length) { setError('Missing mandatory: ' + missing.join(', ')); return; }
    try {
      await api.createDeduction({ ...form, amount: form.amount ? +form.amount : 0 });
      setForm({ ...blank }); setAdding(false); setMsg('✓ Deduction added'); load();
    } catch (e: any) { setError(e.message); }
  };
  const del = async (r: any) => { if (!confirm(`Delete deduction for ${r.awb}?`)) return; try { await api.deleteDeduction(r.id); load(); } catch (e: any) { setError(e.message); } };

  const total = rows.reduce((t, r) => t + Number(r.amount || 0), 0);

  const exportCsv = () => {
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = COLS.map((c) => c.label).join(',');
    const body = rows.map((r) => COLS.map((c) => esc(cell(r, c))).join(',')).join('\n');
    const blob = new Blob([head + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `deductions-${month || 'all'}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const exportXls = async () => {
    const XLSX = await import('xlsx');
    const tags = COLS.map((c) => (c.req ? 'Mandatory' : 'Optional'));
    const head = COLS.map((c) => c.label);
    const data = rows.map((r) => COLS.map((c) => cell(r, c)));
    const ws = XLSX.utils.aoa_to_sheet([['Monthly deduction detail'], tags, head, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deductions');
    XLSX.writeFile(wb, `deductions-${month || 'all'}.xlsx`);
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Monthly deduction detail <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>({rows.length} · ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span></h2>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} title="Filter by month (blank = all)" />
          <button className="secondary" onClick={exportXls} disabled={!rows.length}>⬇ XLS</button>
          <button className="secondary" onClick={exportCsv} disabled={!rows.length}>⬇ CSV</button>
          <button onClick={() => { setForm({ ...blank }); setAdding(true); setError(''); setLookupMsg(''); }}>＋ Add deduction</button>
        </div>
      </div>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)', marginTop: 10 }}>{msg}</div>}

      <div className="card" style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={{ minWidth: 1200 }}>
          <thead>
            <tr>{COLS.map((c) => <th key={c.key} style={{ fontSize: 10, textTransform: 'none', color: c.req ? 'var(--brand)' : 'var(--muted)' }}>{c.req ? 'Mandatory' : 'Optional'}</th>)}<th></th></tr>
            <tr>{COLS.map((c) => <th key={c.key} style={{ whiteSpace: 'nowrap' }}>{c.label}</th>)}<th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {COLS.map((c) => (
                  <td key={c.key} style={{ whiteSpace: 'nowrap' }}>
                    {c.key === 'attachment' && r.attachment && /^https?:\/\//.test(r.attachment)
                      ? <a href={r.attachment} target="_blank" rel="noreferrer">🔗 view</a>
                      : c.key === 'amount' ? <strong>{cell(r, c)}</strong> : cell(r, c)}
                  </td>
                ))}
                <td><button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} title="Delete" onClick={() => del(r)}>🗑</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={COLS.length + 1} className="muted" style={{ textAlign: 'center', padding: 18 }}>No deductions{month ? ` for ${month}` : ''} yet — click “Add deduction”.</td></tr>}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal title="Add deduction" width={720} onClose={() => setAdding(false)}>
          {error && <div className="error">{error}</div>}
          <div className="grid cols-3" style={{ gap: 12 }}>
            {COLS.map((c) => (
              <div key={c.key} style={c.key === 'reason' || c.key === 'attachment' ? { gridColumn: 'span 2' } : undefined}>
                <label style={{ fontSize: 12 }}>{c.label} {c.req ? <span style={{ color: 'var(--danger, #c0392b)' }}>*</span> : <span className="muted">(opt)</span>}</label>
                {c.key === 'status'
                  ? <select value={form.status || 'ongoing'} onChange={(e) => set('status', e.target.value)}>{STATUS_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  : <input type={c.date ? 'date' : c.num ? 'number' : 'text'} value={form[c.key]} onChange={(e) => set(c.key, e.target.value)}
                      placeholder={c.key === 'awb' ? 'enter AWB — auto-fills the rest' : c.key === 'attachment' ? 'link to pic / email' : ''}
                      onBlur={c.key === 'awb' ? (e) => fetchAwb(e.target.value) : undefined}
                      onKeyDown={c.key === 'awb' ? (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchAwb((e.target as HTMLInputElement).value); } } : undefined} />}
                {c.key === 'awb' && lookupMsg && <div className="muted" style={{ fontSize: 11, marginTop: 3, color: lookupMsg.startsWith('✓') ? 'var(--ok, #16a34a)' : 'var(--muted)' }}>{lookupMsg}</div>}
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            <button disabled={!!missing.length} onClick={save}>Save deduction</button>
          </div>
        </Modal>
      )}
    </>
  );
}
