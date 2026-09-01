import { useEffect, useState } from 'react';
import { api } from '../api';

const MODES = ['CASH', 'GPAY', 'UPI', 'A/C TRANSFER', 'CARD', 'CHEQUE'];
const CATEGORIES = ['Vehicle', 'Office expense', 'Stationary', 'Internet charges', 'Staff welfare', 'Freight', 'Fuel', 'Rent', 'Repairs', 'Other'];
const money = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

export function ExpenseTracker() {
  const [data, setData] = useState<{ count: number; total: number; byCategory: Record<string, number>; byBranch: Record<string, number>; rows: any[] } | null>(null);
  const [filters, setFilters] = useState({ from: '', to: '', branch: '', category: '' });
  const [form, setForm] = useState({ date: today(), mode: 'CASH', category: 'Vehicle', remark: '', amount: '', companyAmount: '', paidBy: '', paidTo: '', branch: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => { api.listExpenses({ from: filters.from || undefined, to: filters.to || undefined, branch: filters.branch || undefined, category: filters.category || undefined }).then(setData).catch((e) => setErr(e.message)); };
  useEffect(load, [filters]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const add = async () => {
    setErr(''); setMsg('');
    if (!(Number(form.amount) > 0)) { setErr('Enter an amount greater than zero.'); return; }
    setBusy(true);
    try { await api.createExpense({ ...form, amount: Number(form.amount), companyAmount: form.companyAmount !== '' ? Number(form.companyAmount) : undefined }); setMsg('✓ Expense recorded.'); setForm((f) => ({ ...f, remark: '', amount: '', companyAmount: '', paidTo: '' })); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const remove = async (id: string) => { if (!confirm('Delete this expense?')) return; try { await api.deleteExpense(id); load(); } catch (e: any) { setErr(e.message); } };

  const exportXls = async () => {
    if (!data?.rows.length) return;
    const XLSX = await import('xlsx');
    const head = ['Date', 'Mode', 'Category', 'Remark', 'Amount', 'Paid by', 'Paid to', 'Branch'];
    const rows = data.rows.map((r) => [new Date(r.date).toLocaleDateString('en-GB'), r.mode, r.category, r.remark ?? '', Number(r.amount), r.paidBy ?? '', r.paidTo ?? '', r.branch ?? '']);
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
    XLSX.writeFile(wb, `expenses-${today()}.xlsx`);
  };

  return (
    <>
      <h1>💸 Expense Tracker</h1>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      <div className="card">
        <h2>Record an expense</h2>
        <div className="grid cols-4" style={{ gap: 12 }}>
          <div><label>Date</label><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div><label>Mode of payment</label><select value={form.mode} onChange={(e) => set('mode', e.target.value)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div><label>Category</label><select value={form.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>Amount spent (₹)</label><input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" /></div>
          <div><label>Amount given by company (₹)</label><input type="number" value={form.companyAmount} onChange={(e) => set('companyAmount', e.target.value)} placeholder="(optional)" /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Remark</label><input value={form.remark} onChange={(e) => set('remark', e.target.value)} placeholder="e.g. ALLIED 150 box handling pickup" /></div>
          <div><label>Paid by</label><input value={form.paidBy} onChange={(e) => set('paidBy', e.target.value)} placeholder="Neha" /></div>
          <div><label>Paid to</label><input value={form.paidTo} onChange={(e) => set('paidTo', e.target.value)} placeholder="(optional)" /></div>
          <div><label>Branch</label><input value={form.branch} onChange={(e) => set('branch', e.target.value)} placeholder="BOM / DEL / AHD" /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={busy} onClick={add}>{busy ? 'Saving…' : '➕ Add expense'}</button>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>From</label><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></div>
          <div><label>To</label><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></div>
          <div><label>Branch</label><input value={filters.branch} onChange={(e) => setFilters((f) => ({ ...f, branch: e.target.value }))} placeholder="all" /></div>
          <div><label>Category</label><select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}><option value="">All</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <button className="secondary" onClick={exportXls} disabled={!data?.rows.length}>⬇ Excel</button>
        </div>
      </div>

      {data && (
        <>
          <div className="grid cols-3" style={{ gap: 12 }}>
            <div className="card"><div className="muted">Entries</div><div style={{ fontSize: 24, fontWeight: 800 }}>{data.count}</div></div>
            <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}><div className="muted">Total spent</div><div style={{ fontSize: 24, fontWeight: 800 }}>{money(data.total)}</div></div>
            <div className="card"><div className="muted">Top categories</div><div style={{ fontSize: 12.5, marginTop: 4 }}>{Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => <div key={k} className="row" style={{ justifyContent: 'space-between' }}><span>{k}</span><strong>{money(v)}</strong></div>)}</div></div>
          </div>
          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 13 }}>
                <thead><tr><th>Date</th><th>Mode</th><th>Category</th><th>Remark</th><th style={{ textAlign: 'right' }}>Spent</th><th style={{ textAlign: 'right' }}>Company</th><th>Paid by</th><th>Paid to</th><th>Branch</th><th></th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.date).toLocaleDateString('en-GB')}</td><td>{r.mode}</td><td>{r.category}</td><td>{r.remark || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(Number(r.amount))}</td>
                      <td style={{ textAlign: 'right' }}>{r.companyAmount != null ? money(Number(r.companyAmount)) : '—'}</td>
                      <td>{r.paidBy || '—'}</td><td>{r.paidTo || '—'}</td><td>{r.branch || '—'}</td>
                      <td><button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => remove(r.id)}>🗑</button></td>
                    </tr>
                  ))}
                  {!data.rows.length && <tr><td colSpan={9} className="muted">No expenses recorded for this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
