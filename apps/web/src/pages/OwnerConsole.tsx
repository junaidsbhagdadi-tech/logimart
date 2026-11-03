import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/**
 * Owner console — the "IT guy's" view of the ERP: is it up, what broke, who did what, are the background
 * jobs / carriers / emails / backups / certificates healthy. Only for the owner email(s) set on the server,
 * and only after a one-time code sent to the owner's inbox (12-hour session, this browser tab only).
 */
const TOKEN = 'lm_ops_token';
const getTok = () => { try { return sessionStorage.getItem(TOKEN) || ''; } catch { return ''; } };
const setTok = (t: string) => { try { t ? sessionStorage.setItem(TOKEN, t) : sessionStorage.removeItem(TOKEN); } catch { /* private mode */ } };

const ist = (v?: string | Date | null) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
const ago = (v?: string | Date | null) => {
  if (!v) return '—';
  const m = Math.round((Date.now() - +new Date(v)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const n = (v: any) => Number(v || 0).toLocaleString('en-IN');

type Tone = 'ok' | 'warn' | 'bad' | 'idle';
const toneColor: Record<Tone, string> = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', idle: 'var(--faint)' };
const Dot = ({ t }: { t: Tone }) => <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: toneColor[t], marginRight: 7, flex: 'none' }} />;
const Pill = ({ t, children }: { t: Tone; children: any }) => (
  <span className="badge" style={{ background: `color-mix(in srgb, ${toneColor[t]} 14%, transparent)`, color: toneColor[t] }}>{children}</span>
);

function Gate({ onToken }: { onToken: (t: string) => void }) {
  const [sent, setSent] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => { setBusy(true); setErr(''); try { setSent((await api.opsRequestCode()).sentTo); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.opsVerify(code.trim()); setTok(r.token); onToken(r.token); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ maxWidth: 440 }}>
      <h3 style={{ marginTop: 0 }}>Confirm it's you</h3>
      <p className="muted">The owner console needs a one-time code sent to the owner's inbox, on top of your ERP password.</p>
      {err && <div className="error">{err}</div>}
      {!sent ? (
        <button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
      ) : (
        <form onSubmit={verify} className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>6-digit code sent to {sent}</label><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus placeholder="••••••" style={{ letterSpacing: 4, fontSize: 18, width: 160 }} /></div>
          <button disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Open console'}</button>
          <button type="button" className="secondary" onClick={send} disabled={busy}>Resend</button>
        </form>
      )}
    </div>
  );
}

function Tile({ label, value, sub, t }: { label: string; value: any; sub?: any; t: Tone }) {
  return (
    <div className="card" style={{ padding: '14px 16px', margin: 0 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', alignItems: 'center' }}><Dot t={t} />{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function UptimeBars({ days, trackedFrom }: { days: { day: string; up: number; e5: number }[]; trackedFrom: string }) {
  const map = new Map(days.map((d) => [String(d.day).slice(0, 10), d]));
  const today = new Date(Date.now() + 330 * 60000);
  const cells = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(+today - (29 - i) * 864e5).toISOString().slice(0, 10);
    const row = map.get(d);
    const isToday = i === 29;
    const minsSoFar = isToday ? today.getUTCHours() * 60 + today.getUTCMinutes() : 1440;
    const startedThatDay = d === new Date(+new Date(trackedFrom) + 330 * 60000).toISOString().slice(0, 10);
    const pct = row ? Math.min(100, (row.up / Math.max(1, minsSoFar)) * 100) : null;
    const t: Tone = pct == null ? 'idle' : startedThatDay || pct >= 99.5 ? 'ok' : pct >= 97 ? 'warn' : 'bad';
    return { d, pct, t, e5: row?.e5 ?? 0 };
  });
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 34 }}>
      {cells.map((c) => (
        <div key={c.d} title={`${c.d.split('-').reverse().join('-')} · ${c.pct == null ? 'not tracked' : `${c.pct.toFixed(1)}% up`} · ${c.e5} server errors`}
          style={{ flex: 1, height: '100%', borderRadius: 3, background: toneColor[c.t], opacity: c.t === 'idle' ? 0.25 : 0.9 }} />
      ))}
    </div>
  );
}

export function OwnerConsole() {
  const [tok, setTokState] = useState(getTok());
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'overview' | 'errors' | 'security' | 'jobs' | 'log'>('overview');
  const [detail, setDetail] = useState<{ title: string; rows: any[] } | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [log, setLog] = useState<any[] | null>(null);
  const [note, setNote] = useState('');

  const expired = (e: any) => /OPS_SESSION/.test(String(e?.message)) && (setTok(''), setTokState(''), true);
  const load = async (t = tok) => {
    if (!t) return;
    setBusy(true); setErr('');
    try { setData(await api.opsOverview(t)); } catch (e: any) { if (!expired(e)) setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); const i = setInterval(() => load(), 60_000); return () => clearInterval(i); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tok]);

  const openEvents = async (title: string, p: any) => {
    try { setDetail({ title, rows: await api.opsEvents(tok, { ...p, limit: 100 }) }); } catch (e: any) { if (!expired(e)) setErr(e.message); }
  };
  const openJob = async (name: string) => {
    try { setDetail({ title: `${name} — last 100 runs`, rows: (await api.opsJob(tok, name)).map((r) => ({ at: r.startedAt, level: r.ok === false ? 'error' : r.ok ? 'info' : 'warn', message: r.ok === false ? r.error : r.summary ?? (r.finishedAt ? 'ok' : 'running / never finished'), detail: { seconds: r.finishedAt ? ((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000).toFixed(1) : null } })) }); } catch (e: any) { if (!expired(e)) setErr(e.message); }
  };
  const searchLog = async () => { try { setLog(await api.opsEvents(tok, { kind: kind || undefined, search: q || undefined, limit: 300 })); } catch (e: any) { if (!expired(e)) setErr(e.message); } };
  const testAlert = async () => { try { const r = await api.opsTestAlert(tok); setNote(r.ok ? `Test alert sent to ${r.to}` : 'Test alert could not be sent — check the email service.'); } catch (e: any) { if (!expired(e)) setErr(e.message); } };

  const health = useMemo(() => {
    if (!data) return null;
    const s = data.server, db = data.db;
    const failingJobs = (data.jobs || []).filter((j: any) => j.ok === false);
    const certLow = (data.certs || []).filter((c: any) => c.daysLeft == null || c.daysLeft <= 14);
    const backupAge = data.backups?.offsite?.startedAt ? (Date.now() - +new Date(data.backups.offsite.startedAt)) / 3600000 : null;
    const problems: string[] = [];
    if (data.traffic.errors5xx24h > 50) problems.push(`${n(data.traffic.errors5xx24h)} server errors today`);
    if (s.memPct >= 88) problems.push(`memory ${s.memPct}%`);
    if ((s.diskPct ?? 0) >= 85) problems.push(`disk ${s.diskPct}%`);
    if (db.connections >= db.maxConnections - 4) problems.push(`DB connections ${db.connections}/${db.maxConnections}`);
    if (failingJobs.length) problems.push(`${failingJobs.length} job(s) failing`);
    if (certLow.length) problems.push(`certificate: ${certLow.map((c: any) => c.host).join(', ')}`);
    if (data.email.credits && data.email.credits.left <= 0) problems.push('email credits used up — nothing is being delivered');
    if (backupAge == null || backupAge > 30 || data.backups?.offsite?.ok === false) problems.push('off-site backup not current');
    return { failingJobs, certLow, backupAge, problems };
  }, [data]);

  if (!tok) return (<><h1>🛰 Owner Console</h1><Gate onToken={(t) => { setTokState(t); }} /></>);

  const tabs: [typeof tab, string][] = [['overview', 'Overview'], ['errors', 'Errors'], ['security', 'Security'], ['jobs', 'Jobs & carriers'], ['log', 'Event log']];
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ margin: 0 }}>🛰 Owner Console</h1>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>{data ? `Updated ${ist(data.at)} · refreshes every minute` : ''}</span>
          <button className="secondary" onClick={() => load()} disabled={busy}>{busy ? '…' : '↻'}</button>
          <button className="secondary" onClick={testAlert}>Send test alert</button>
          <button className="secondary" onClick={() => { setTok(''); setTokState(''); }}>Lock</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {note && <div className="card" style={{ padding: '8px 14px' }}>{note}</div>}
      {!data ? <p className="muted">Loading…</p> : (
        <>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderLeft: `5px solid ${health!.problems.length ? 'var(--warn)' : 'var(--ok)'}` }}>
            <Dot t={health!.problems.length ? 'warn' : 'ok'} />
            <div style={{ fontWeight: 700 }}>{health!.problems.length ? `Needs a look: ${health!.problems.join(' · ')}` : 'All systems normal'}</div>
          </div>

          <div className="row" style={{ gap: 6, margin: '12px 0', flexWrap: 'wrap' }}>
            {tabs.map(([k, l]) => <button key={k} className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>{l}</button>)}
          </div>

          {tab === 'overview' && (
            <>
              <div className="grid cols-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                <Tile label="Uptime · 30 days" value={`${data.uptime.pct30}%`} sub={`tracked since ${ist(data.uptime.trackedFrom)}`} t={data.uptime.pct30 >= 99.5 ? 'ok' : data.uptime.pct30 >= 97 ? 'warn' : 'bad'} />
                <Tile label="Requests · 24 h" value={n(data.traffic.requests24h)} sub={`avg ${data.traffic.avgMs} ms · slowest ${n(data.traffic.maxMs)} ms`} t={data.traffic.avgMs > 1500 ? 'warn' : 'ok'} />
                <Tile label="Server errors · 24 h" value={n(data.traffic.errors5xx24h)} sub={`${data.errors.groups.length} distinct problem(s)`} t={data.traffic.errors5xx24h > 50 ? 'bad' : data.traffic.errors5xx24h > 0 ? 'warn' : 'ok'} />
                <Tile label="Failed logins · 24 h" value={n(data.security.failedLogins24h)} sub={`${n(data.security.deletes24h)} deletes / cancels`} t={data.security.failedLogins24h > 30 ? 'bad' : data.security.failedLogins24h > 5 ? 'warn' : 'ok'} />
                <Tile label="Server" value={`${data.server.memPct}% mem`} sub={`CPU ${data.server.cpuPct}% · disk ${data.server.diskPct ?? '?'}% (${data.server.diskFreeGb ?? '?'} GB free) · app ${data.server.processMb} MB`} t={data.server.memPct >= 88 || (data.server.diskPct ?? 0) >= 85 ? 'bad' : data.server.memPct >= 75 ? 'warn' : 'ok'} />
                <Tile label="Database" value={`${n(data.db.sizeMb)} MB`} sub={`${data.db.connections}/${data.db.maxConnections} connections`} t={data.db.connections >= data.db.maxConnections - 4 ? 'bad' : data.db.connections >= data.db.maxConnections - 8 ? 'warn' : 'ok'} />
                <Tile label="Email credits left" value={data.email.credits ? n(data.email.credits.left) : data.email.provider === 'Amazon SES' ? 'SES' : '—'} sub={data.email.credits ? `Brevo ${data.email.credits.plan} plan — at 0, emails silently stop` : data.email.provider === 'Amazon SES' ? 'Amazon SES — pay per email, no daily credit limit' : 'could not read Brevo'} t={!data.email.credits ? (data.email.provider === 'Amazon SES' ? 'ok' : 'idle') : data.email.credits.left <= 0 ? 'bad' : data.email.credits.left < 60 ? 'warn' : 'ok'} />
                <Tile label="Emails · 24 h" value={n(data.email.sent)} sub={`${n((data.email.failed || 0) + (data.email.queued || 0))} not delivered · ${n(data.email.invalid)} bad addresses`} t={(data.email.failed || 0) + (data.email.queued || 0) > 5 ? 'warn' : 'ok'} />
                <Tile label="Customer API · 24 h" value={n(data.traffic.extCalls24h)} sub="calls to /api/ext" t="ok" />
              </div>

              <div className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}><b>Uptime, last 30 days</b><span className="muted" style={{ fontSize: 12.5 }}>a minute with no heartbeat = the app was down</span></div>
                <div style={{ marginTop: 10 }}><UptimeBars days={data.uptime.days} trackedFrom={data.uptime.trackedFrom} /></div>
                {data.uptime.outages?.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    {data.uptime.outages.slice(0, 6).map((o: any, i: number) => <div key={i}><Dot t="bad" />Down {ist(o.from)} → {ist(o.to)} ({Math.round(o.mins)} min)</div>)}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Restarts this week: {data.boots.length} {data.boots[0] ? `· last ${ist(data.boots[0])}` : ''} · Last deploy: {data.deploy ? `${data.deploy.hash} “${data.deploy.subject}” ${ago(data.deploy.at)}` : '—'}</div>
              </div>

              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
                <div className="card" style={{ margin: 0 }}>
                  <b>Backups</b>
                  <div style={{ marginTop: 8, fontSize: 13.5, display: 'grid', gap: 6 }}>
                    <div><Dot t={!data.backups.offsite ? 'bad' : data.backups.offsite.ok === false ? 'bad' : (health!.backupAge ?? 99) > 30 ? 'warn' : 'ok'} />Off-site (DO Spaces): {data.backups.offsite ? `${data.backups.offsite.ok === false ? 'FAILED' : 'ok'} ${ago(data.backups.offsite.startedAt)} — ${data.backups.offsite.summary ?? data.backups.offsite.error ?? ''}` : 'none yet (first one runs tonight 02:30)'}</div>
                    <div><Dot t={data.backups.local ? 'ok' : 'warn'} />On the server: {data.backups.local ? `${data.backups.local.file} · ${data.backups.local.mb} MB · ${ago(data.backups.local.at)}` : 'not found'}</div>
                    <div><Dot t="ok" />Database provider: daily automatic backups (DigitalOcean)</div>
                  </div>
                </div>
                <div className="card" style={{ margin: 0 }}>
                  <b>Certificates, demo & app</b>
                  <div style={{ marginTop: 8, fontSize: 13.5, display: 'grid', gap: 6 }}>
                    {data.certs.map((c: any) => <div key={c.host}><Dot t={c.daysLeft == null ? 'bad' : c.daysLeft <= 14 ? 'warn' : 'ok'} />{c.host}: {c.daysLeft == null ? `unreachable (${c.error})` : `HTTPS valid ${c.daysLeft} more days`}</div>)}
                    <div><Dot t={data.demo.ok ? 'ok' : 'bad'} />Sales demo ERP: {data.demo.ok ? `up (${data.demo.ms} ms)` : `DOWN ${data.demo.error ?? data.demo.status ?? ''}`}</div>
                    <div><Dot t={data.app ? 'ok' : 'idle'} />Rider app published: {data.app ? `v${data.app.version}` : '—'}</div>
                  </div>
                </div>
                <div className="card" style={{ margin: 0 }}>
                  <b>Slowest screens · 24 h</b>
                  <div style={{ marginTop: 8, fontSize: 13, display: 'grid', gap: 5 }}>
                    {data.traffic.slowest.length ? data.traffic.slowest.map((s: any) => <div key={s.path} className="row" style={{ justifyContent: 'space-between', gap: 10 }}><code style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.path}</code><b style={{ color: s.ms > 10000 ? 'var(--bad)' : s.ms > 3000 ? 'var(--warn)' : undefined }}>{(s.ms / 1000).toFixed(1)} s</b></div>) : <span className="muted">No data yet.</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Biggest tables: {data.db.biggest.map((b: any) => `${b.name} ${n(b.mb)} MB`).join(' · ')}</div>
                </div>
              </div>

              {data.alerts.length > 0 && (
                <div className="card">
                  <b>Alerts emailed · 7 days</b>
                  <div style={{ marginTop: 8, fontSize: 13.5, display: 'grid', gap: 5 }}>{data.alerts.map((a: any, i: number) => <div key={i}><Dot t="warn" />{ist(a.at)} — {a.message}</div>)}</div>
                </div>
              )}
            </>
          )}

          {tab === 'errors' && (
            <div className="card">
              <b>Server errors · 24 h, grouped</b> <span className="muted" style={{ fontSize: 12.5 }}>— click one to see each occurrence with the technical trace</span>
              <div className="table-wrap" style={{ overflowX: 'auto', marginTop: 10 }}>
                <table>
                  <thead><tr><th>Times</th><th>Where</th><th>What</th><th>Last</th></tr></thead>
                  <tbody>
                    {data.errors.groups.length ? data.errors.groups.map((g: any) => (
                      <tr key={g.fingerprint} style={{ cursor: 'pointer' }} onClick={() => openEvents(g.message, { fingerprint: g.fingerprint })}>
                        <td><Pill t={g.n > 20 ? 'bad' : 'warn'}>{g.n}×</Pill></td><td><code>{g.source}</code></td><td>{g.message}</td><td style={{ whiteSpace: 'nowrap' }}>{ago(g.last)}</td>
                      </tr>
                    )) : <tr><td colSpan={4} className="muted">No server errors in the last 24 hours.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div className="card">
              <b>Security · 24 h</b> <span className="muted" style={{ fontSize: 12.5 }}>— wrong passwords, lock-outs, admin sign-ins (new networks flagged), user / access changes, deletes</span>
              <div style={{ marginTop: 10, fontSize: 13.5, display: 'grid', gap: 6 }}>
                {data.security.recent.length ? data.security.recent.map((s: any, i: number) => (
                  <div key={i} className="row" style={{ gap: 10, alignItems: 'baseline' }}><span className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12.5, width: 110 }}>{ist(s.at)}</span><Dot t={s.level === 'error' ? 'bad' : s.level === 'warn' ? 'warn' : 'ok'} /><span>{s.message}</span></div>
                )) : <span className="muted">Nothing in the last 24 hours.</span>}
              </div>
            </div>
          )}

          {tab === 'jobs' && (
            <div className="card">
              <b>Background jobs</b> <span className="muted" style={{ fontSize: 12.5 }}>— carrier tracking syncs, auto hand-off, MIS, summaries, backups. Click a row for its history.</span>
              <div className="table-wrap" style={{ overflowX: 'auto', marginTop: 10 }}>
                <table>
                  <thead><tr><th>Job</th><th>Last run</th><th>Result</th><th>Runs 24 h</th><th>Avg time</th></tr></thead>
                  <tbody>
                    {data.jobs.length ? data.jobs.map((j: any) => (
                      <tr key={j.job} style={{ cursor: 'pointer' }} onClick={() => openJob(j.job)}>
                        <td style={{ fontWeight: 600 }}><Dot t={j.ok === false ? 'bad' : j.ok ? 'ok' : 'warn'} />{j.job}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{ago(j.startedAt)}</td>
                        <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.error ?? j.summary ?? ''}>{j.ok === false ? <span style={{ color: 'var(--bad)' }}>{j.error}</span> : j.summary ?? (j.finishedAt ? 'ok' : 'running…')}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{j.ok24h}/{j.runs24h}</td>
                        <td>{j.avgSecs != null ? `${j.avgSecs} s` : '—'}</td>
                      </tr>
                    )) : <tr><td colSpan={5} className="muted">No runs recorded yet — they appear within a few minutes of the deploy.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'log' && (
            <div className="card">
              <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><label>Type</label><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option><option value="error">Errors</option><option value="security">Security</option><option value="alert">Alerts</option><option value="boot">Restarts</option></select></div>
                <div style={{ flex: 1, minWidth: 220 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchLog()} placeholder="AWB, user email, route, carrier…" /></div>
                <button onClick={searchLog}>Search</button>
              </div>
              <EventList rows={log ?? []} empty={log ? 'Nothing found (events are kept 30 days).' : 'Search the last 30 days of events.'} />
            </div>
          )}
        </>
      )}

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(900px, 100%)', maxHeight: '85vh', overflow: 'auto', margin: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}><b style={{ overflowWrap: 'anywhere' }}>{detail.title}</b><button className="secondary" onClick={() => setDetail(null)}>Close</button></div>
            <EventList rows={detail.rows} empty="No occurrences." />
          </div>
        </div>
      )}
    </>
  );
}

function EventList({ rows, empty }: { rows: any[]; empty: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 13.5 }}>
      {rows.map((r, i) => (
        <div key={r.id ?? i} style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
          <div className="row" style={{ gap: 10, alignItems: 'baseline', cursor: r.detail ? 'pointer' : undefined }} onClick={() => setOpen(open === i ? null : i)}>
            <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12.5, width: 110, flex: 'none' }}>{ist(r.at)}</span>
            <Dot t={r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : 'ok'} />
            <span style={{ overflowWrap: 'anywhere' }}>{r.kind ? <b style={{ fontSize: 11.5, textTransform: 'uppercase', marginRight: 6 }}>{r.kind}</b> : null}{r.source ? <code style={{ marginRight: 6 }}>{r.source}</code> : null}{r.message}</span>
          </div>
          {open === i && r.detail && Object.keys(r.detail).length > 0 && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, background: 'var(--bg-soft)', padding: 10, borderRadius: 8, margin: '6px 0 0', overflowX: 'auto' }}>{r.detail.stack ? `${r.detail.stack}\n\n` : ''}{JSON.stringify({ ...r.detail, stack: undefined }, null, 2)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
