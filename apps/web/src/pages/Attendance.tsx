import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/**
 * Staff attendance from the sign-in / sign-out trail (web + rider app). Per-person summary for the
 * period (days present, hours) plus the day-by-day log, exportable to Excel for salary.
 */
type Row = { userId: string; name: string; login: string; role: string; department: string | null; date: string; firstIn: string | null; lastOut: string | null; lastIn: string | null; logins: number; hours: number | null };
type Sum = { userId: string; name: string; login: string; role: string; department: string | null; daysPresent: number; totalHours: number; missingSignOut: number };

const ymd = (d: Date) => new Date(+d + 330 * 60000).toISOString().slice(0, 10);
const tm = (v: string | null) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
const dmy = (v: string) => v.split('-').reverse().join('-');

export function Attendance() {
  const now = new Date();
  const [from, setFrom] = useState(ymd(new Date(now.getFullYear(), now.getMonth(), 1, 12)));
  const [to, setTo] = useState(ymd(now));
  const [data, setData] = useState<{ rows: Row[]; summary: Sum[] } | null>(null);
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setBusy(true); setError('');
    try { setData(await api.attendance(from, to)); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const match = (x: { name: string; login: string }) => !q.trim() || `${x.name} ${x.login}`.toLowerCase().includes(q.trim().toLowerCase());
  const summary = useMemo(() => (data?.summary ?? []).filter(match), [data, q]);
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => (!who || r.userId === who) && match(r)), [data, q, who]);

  const exportXls = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary.map((s) => ({
      Name: s.name, Login: s.login, Role: s.role, Department: s.department ?? '', 'Days present': s.daysPresent, 'Total hours': s.totalHours, 'Days without sign-out': s.missingSignOut,
    }))), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({
      Date: dmy(r.date), Name: r.name, Login: r.login, 'First sign-in': tm(r.firstIn), 'Last sign-out': tm(r.lastOut), 'Last sign-in': tm(r.lastIn), 'Sign-ins': r.logins, Hours: r.hours ?? '',
    }))), 'Day-wise');
    XLSX.writeFile(wb, `Attendance-${from}-to-${to}.xlsx`);
  };

  return (
    <>
      <h1>🕒 Staff Attendance</h1>
      <p className="muted" style={{ marginTop: -6 }}>Every sign-in and sign-out (ERP web and rider app) is recorded. Hours = first sign-in → last sign-out of the day; a day with no sign-out counts as present with blank hours.</p>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Show'}</button>
          <div style={{ flex: 1, minWidth: 200 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name / login" /></div>
          <button className="secondary" onClick={exportXls} disabled={!data}>⬇ Excel</button>
        </div>
      </div>

      {data && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Summary · {dmy(from)} → {dmy(to)}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Name</th><th>Login</th><th>Department</th><th style={{ textAlign: 'right' }}>Days present</th><th style={{ textAlign: 'right' }}>Total hours</th><th style={{ textAlign: 'right' }}>No sign-out</th><th></th></tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.userId} style={who === s.userId ? { background: 'var(--bg-soft, #eef6f4)' } : undefined}>
                    <td><strong>{s.name}</strong></td>
                    <td className="muted">{s.login}</td>
                    <td>{s.department ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{s.daysPresent}</td>
                    <td style={{ textAlign: 'right' }}>{s.totalHours.toFixed(1)}</td>
                    <td style={{ textAlign: 'right' }}>{s.missingSignOut || '—'}</td>
                    <td><button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setWho(who === s.userId ? '' : s.userId)}>{who === s.userId ? 'All days' : 'Days'}</button></td>
                  </tr>
                ))}
                {!summary.length && <tr><td colSpan={7} className="muted">No staff match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Day-wise log {who && `· ${summary.find((s) => s.userId === who)?.name ?? ''}`}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Date</th><th>Name</th><th>First sign-in</th><th>Last sign-out</th><th style={{ textAlign: 'right' }}>Sign-ins</th><th style={{ textAlign: 'right' }}>Hours</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.userId}|${r.date}`}>
                    <td>{dmy(r.date)}</td><td>{r.name}</td><td>{tm(r.firstIn)}</td>
                    <td>{r.lastOut ? tm(r.lastOut) : <span className="muted" title={`Last sign-in ${tm(r.lastIn)}`}>not signed out</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.logins}</td><td style={{ textAlign: 'right' }}>{r.hours != null ? r.hours.toFixed(1) : '—'}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="muted">No sign-ins recorded in this period (recording began when this feature went live).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
