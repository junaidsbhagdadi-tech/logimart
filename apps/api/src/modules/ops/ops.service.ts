import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OpsEventInput, isOpsOwnerEmail, registerOpsSink } from '../../common/ops-hooks';

const run = promisify(execFile);
const RETENTION_DAYS = 30;
const MIN = 60_000;

/** Owner list + alert inbox come from the server .env only — no screen can change who sees the console. */
const alertTo = () => String(process.env.OPS_ALERT_EMAIL || String(process.env.OPS_OWNER_EMAILS || '').split(/[,;\s]+/).filter(Boolean)[0] || '').trim();
const secret = () => `${process.env.JWT_SECRET || 'x'}:ops`;

type Bucket = { requests: number; e5: number; e4: number; totalMs: number; maxMs: number; slowPath: string | null; ext: number };

/**
 * Owner console (#monitoring): records errors / security events / per-minute traffic / job runs into
 * Postgres (multi-instance safe, 30-day retention), computes health (server, DB, certificates, backups,
 * carriers, email), emails alerts with de-duplication, and gates everything behind owner email + a
 * one-time code.
 */
@Injectable()
export class OpsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Ops');
  private bucket: Bucket = this.empty();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService, private readonly mail: NotificationsService) {}

  private empty(): Bucket { return { requests: 0, e5: 0, e4: 0, totalMs: 0, maxMs: 0, slowPath: null, ext: 0 }; }

  onModuleInit() {
    registerOpsSink({
      record: (e) => this.record(e),
      jobStart: (name) => this.prisma.opsJobRun.create({ data: { job: name } }).then((r) => r.id).catch(() => null),
      jobEnd: (id, name, ok, summary, error) => {
        const data = { finishedAt: new Date(), ok, summary: summary ?? null, error: error ?? null };
        (id ? this.prisma.opsJobRun.update({ where: { id }, data }) : this.prisma.opsJobRun.create({ data: { job: name, ...data } })).catch(() => undefined);
        if (!ok) this.record({ kind: 'error', level: 'error', source: `job:${name}`, message: `${name} failed: ${error ?? ''}`.slice(0, 500), fingerprint: `job:${name}` });
      },
      http: (method, p, status, ms) => {
        const b = this.bucket;
        b.requests++; b.totalMs += ms;
        if (status >= 500) b.e5++; else if (status >= 400) b.e4++;
        if (ms > b.maxMs) { b.maxMs = ms; b.slowPath = `${method} ${p.split('?')[0].replace(/\/\d{3,}/g, '/:id').slice(0, 120)}`; }
        if (p.startsWith('/api/ext')) b.ext++;
      },
      alert: (key, subject, body) => { this.securityAlert(key, subject, body).catch(() => undefined); },
    });
    this.record({ kind: 'boot', level: 'info', source: 'api', message: `API started (pid ${process.pid})`, detail: { pid: process.pid, node: process.version } });
    // Heartbeat + traffic flush every minute: a minute with no row = the app wasn't running.
    this.timers.push(setInterval(() => this.flush().catch(() => undefined), MIN));
    this.timers.push(setInterval(() => this.checkAlerts().catch((e) => this.log.warn(`alerts: ${e?.message || e}`)), 2 * MIN));
    process.on('unhandledRejection', (r: any) => this.record({ kind: 'error', level: 'error', source: 'process', message: `Unhandled rejection: ${String(r?.message || r).slice(0, 400)}`, detail: { stack: String(r?.stack || '').slice(0, 4000) }, fingerprint: `unhandled:${String(r?.message || r).slice(0, 80)}` }));
  }

  onModuleDestroy() { this.timers.forEach(clearInterval); this.flush().catch(() => undefined); }

  record(e: OpsEventInput) {
    this.prisma.opsEvent.create({
      data: {
        kind: e.kind, level: e.level ?? (e.kind === 'error' ? 'error' : 'info'), source: e.source ?? null, message: String(e.message).slice(0, 1000),
        detail: (e.detail ?? {}) as any, fingerprint: (e.fingerprint ?? `${e.kind}:${e.source ?? ''}:${String(e.message).slice(0, 80)}`).slice(0, 190),
        userId: e.userId != null ? BigInt(e.userId as any) : null,
      },
    }).catch(() => undefined);
  }

  private async flush() {
    const b = this.bucket; this.bucket = this.empty();
    const minute = new Date(Math.floor(Date.now() / MIN) * MIN);
    await this.prisma.$executeRaw`
      INSERT INTO ops_minutes (minute, requests, errors5xx, errors4xx, "totalMs", "maxMs", "slowPath", "extCalls")
      VALUES (${minute}, ${b.requests}, ${b.e5}, ${b.e4}, ${b.totalMs}, ${b.maxMs}, ${b.slowPath}, ${b.ext})
      ON CONFLICT (minute) DO UPDATE SET requests = ops_minutes.requests + EXCLUDED.requests, errors5xx = ops_minutes.errors5xx + EXCLUDED.errors5xx,
        errors4xx = ops_minutes.errors4xx + EXCLUDED.errors4xx, "totalMs" = ops_minutes."totalMs" + EXCLUDED."totalMs",
        "maxMs" = GREATEST(ops_minutes."maxMs", EXCLUDED."maxMs"),
        "slowPath" = CASE WHEN EXCLUDED."maxMs" > ops_minutes."maxMs" THEN EXCLUDED."slowPath" ELSE ops_minutes."slowPath" END,
        "extCalls" = ops_minutes."extCalls" + EXCLUDED."extCalls"`;
  }

  // ---------------------------------------------------------------- access (owner + one-time code)

  isOwner(email?: string | null) { return isOpsOwnerEmail(email); }

  async isOwnerUser(userId: unknown) {
    if (!/^\d+$/.test(String(userId ?? ''))) return false;
    const u = await this.prisma.user.findUnique({ where: { id: BigInt(String(userId)) }, select: { email: true, isActive: true } }).catch(() => null);
    return !!u?.isActive && this.isOwner(u.email);
  }

  async testAlert() {
    const to = alertTo();
    const ok = to ? await this.mail.sendMail({ to: [to], subject: '[ERP alert] Test alert', text: 'This is a test from the owner console. Real alerts look like this.' }).catch(() => false) : false;
    return { ok, to: to.replace(/^(.).*(@.*)$/, '$1•••$2') };
  }

  private async ownerEmail(userId: string | number): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: BigInt(userId) }, select: { email: true, isActive: true } });
    if (!u?.isActive || !this.isOwner(u.email)) throw new ForbiddenException('Not available.');
    return u.email;
  }

  async requestCode(userId: string | number) {
    await this.ownerEmail(userId);
    const to = alertTo();
    if (!to) throw new BadRequestException('OPS_ALERT_EMAIL is not set on the server.');
    const code = String(randomInt(100000, 1000000));
    const key = `OPS_OTP:${userId}`;
    const prev = await this.prisma.integrationToken.findUnique({ where: { provider: key }, select: { updatedAt: true } });
    if (prev && Date.now() - +prev.updatedAt < 60_000) throw new BadRequestException('A code was just sent — wait a minute before asking for another.');
    await this.prisma.integrationToken.upsert({
      where: { provider: key },
      update: { token: JSON.stringify({ h: this.hash(code), tries: 0 }), expiresAt: new Date(Date.now() + 10 * MIN) },
      create: { provider: key, token: JSON.stringify({ h: this.hash(code), tries: 0 }), expiresAt: new Date(Date.now() + 10 * MIN) },
    });
    const credits = await this.emailCredits(true);
    if (credits && credits.left <= 0) throw new BadRequestException(`The email service (Brevo, ${credits.plan} plan) has no sending credits left, so the code can't be delivered. Top up / upgrade Brevo, then try again.`);
    const sent = await this.mail.sendMail({
      to: [to], subject: 'Logimart ERP sign-in code',
      text: `Your Logimart owner-console sign-in code is ${code}. It expires in 10 minutes.\nIf you didn't request it, someone has your ERP password — change it now.`,
      html: `<div style="font:15px Arial,sans-serif;color:#12262b"><p>Your Logimart owner-console sign-in code:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p><p style="color:#4d6a70">It expires in 10 minutes. If you didn't request it, someone has your ERP password — change it now.</p></div>`,
    });
    this.record({ kind: 'security', level: 'info', source: 'ops', message: 'Owner console code requested', userId: String(userId) });
    if (!sent) throw new BadRequestException('Could not send the code — check the email service.');
    return { ok: true, sentTo: to.replace(/^(.).*(@.*)$/, '$1•••$2') };
  }

  async verifyCode(userId: string | number, code: string, ip: string) {
    await this.ownerEmail(userId);
    const key = `OPS_OTP:${userId}`;
    const row = await this.prisma.integrationToken.findUnique({ where: { provider: key } });
    const st = row ? JSON.parse(row.token) : null;
    if (!row || !st || +row.expiresAt < Date.now()) throw new BadRequestException('Code expired — request a new one.');
    if (st.tries >= 5) throw new BadRequestException('Too many wrong codes — request a new one.');
    if (this.hash(String(code || '').trim()) !== st.h) {
      await this.prisma.integrationToken.update({ where: { provider: key }, data: { token: JSON.stringify({ ...st, tries: st.tries + 1 }) } });
      this.record({ kind: 'security', level: 'warn', source: 'ops', message: `Wrong owner-console code from ${ip}`, userId: String(userId), fingerprint: 'ops:badcode' });
      throw new BadRequestException('Wrong code.');
    }
    await this.prisma.integrationToken.delete({ where: { provider: key } }).catch(() => undefined);
    this.record({ kind: 'security', level: 'info', source: 'ops', message: `Owner console opened from ${ip}`, userId: String(userId) });
    const exp = Date.now() + 12 * 3600_000;
    const body = `${userId}.${exp}`;
    return { token: `${body}.${this.sign(body)}`, expiresAt: new Date(exp) };
  }

  assertToken(userId: string | number, token?: string) {
    const [uid, exp, sig] = String(token || '').split('.');
    if (!uid || !exp || !sig || uid !== String(userId) || +exp < Date.now()) throw new ForbiddenException('OPS_SESSION: Owner console session expired — sign in with a new code.');
    const want = Buffer.from(this.sign(`${uid}.${exp}`)); const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new ForbiddenException('OPS_SESSION: Owner console session expired — sign in with a new code.');
  }

  /** Brevo sending credits left (its API accepts mail even at 0 credits and drops it later, so check). */
  private creditsCache: { at: number; v: { plan: string; left: number } | null } | null = null;
  async emailCredits(fresh = false): Promise<{ plan: string; left: number } | null> {
    if (!process.env.BREVO_API_KEY) return null;
    if (!fresh && this.creditsCache && Date.now() - this.creditsCache.at < 10 * MIN) return this.creditsCache.v;
    let v: { plan: string; left: number } | null = null;
    try {
      const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      const plans: any[] = r.ok ? ((await r.json()) as any)?.plan ?? [] : [];
      const p = plans.find((x) => x.creditsType === 'sendLimit') ?? plans[0];
      if (p) v = { plan: String(p.type), left: Number(p.credits ?? 0) };
    } catch { v = null; }
    this.creditsCache = { at: Date.now(), v };
    return v;
  }

  private hash(s: string) { return createHash('sha256').update(`${secret()}:${s}`).digest('hex'); }
  private sign(s: string) { return createHmac('sha256', secret()).update(s).digest('base64url'); }

  // ---------------------------------------------------------------- the console's data

  async overview() {
    const now = Date.now();
    const d1 = new Date(now - 864e5), d7 = new Date(now - 7 * 864e5), d30 = new Date(now - 30 * 864e5);
    const [minutes, errors, errorsByFp, security, jobs, boots, notif, auditDeletes, failedLogins, dbStats, alerts] = await Promise.all([
      this.prisma.$queryRaw<any[]>`SELECT date_trunc('day', minute AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*)::int AS up, sum(requests)::int AS req, sum(errors5xx)::int AS e5 FROM ops_minutes WHERE minute >= ${d30} GROUP BY 1 ORDER BY 1`,
      this.prisma.opsEvent.count({ where: { kind: 'error', at: { gte: d1 } } }),
      this.prisma.$queryRaw<any[]>`SELECT fingerprint, max(message) AS message, max(source) AS source, count(*)::int AS n, max(at) AS last FROM ops_events WHERE kind = 'error' AND at >= ${d1} GROUP BY fingerprint ORDER BY n DESC LIMIT 12`,
      this.prisma.opsEvent.findMany({ where: { kind: 'security', at: { gte: d1 } }, orderBy: { at: 'desc' }, take: 40 }),
      this.prisma.$queryRaw<any[]>`SELECT DISTINCT ON (job) job, "startedAt", "finishedAt", ok, summary, error FROM ops_job_runs ORDER BY job, "startedAt" DESC`,
      this.prisma.opsEvent.findMany({ where: { kind: 'boot', at: { gte: d7 } }, orderBy: { at: 'desc' }, select: { at: true, message: true } }),
      this.prisma.notification.groupBy({ by: ['status'], where: { channel: 'email', createdAt: { gte: d1 } }, _count: { _all: true } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: d1 }, OR: [{ method: 'DELETE' }, { path: { contains: '/delete' } }, { path: { contains: '/void' } }, { path: { contains: '/cancel' } }] } }).catch(() => 0),
      this.prisma.opsEvent.count({ where: { kind: 'security', fingerprint: 'login:failed', at: { gte: d1 } } }),
      this.db(),
      this.prisma.opsEvent.findMany({ where: { kind: 'alert', at: { gte: d7 } }, orderBy: { at: 'desc' }, take: 20, select: { at: true, message: true, level: true } }),
    ]);
    const jobStats = await this.prisma.$queryRaw<any[]>`SELECT job, count(*)::int AS runs, sum(CASE WHEN ok THEN 1 ELSE 0 END)::int AS ok, avg(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")))::float AS secs FROM ops_job_runs WHERE "startedAt" >= ${d1} AND "finishedAt" IS NOT NULL GROUP BY job`;
    const statsBy = new Map(jobStats.map((j) => [j.job, j]));
    const first = await this.prisma.opsMinute.findFirst({ orderBy: { minute: 'asc' }, select: { minute: true } });
    const trackedFrom = first?.minute ?? new Date();
    const totalMin = Math.max(1, Math.floor((now - Math.max(+trackedFrom, +d30)) / MIN));
    const upMin = minutes.reduce((s, m) => s + m.up, 0);
    const last24 = await this.prisma.$queryRaw<any[]>`SELECT coalesce(sum(requests),0)::int AS req, coalesce(sum(errors5xx),0)::int AS e5, coalesce(sum("totalMs"),0)::float AS ms, coalesce(max("maxMs"),0)::int AS max, sum("extCalls")::int AS ext FROM ops_minutes WHERE minute >= ${d1}`;
    const slow = await this.prisma.$queryRaw<any[]>`SELECT "slowPath" AS path, max("maxMs")::int AS ms FROM ops_minutes WHERE minute >= ${d1} AND "slowPath" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
    const outages = await this.prisma.$queryRaw<any[]>`
      SELECT prev AS "from", minute AS "to", EXTRACT(EPOCH FROM (minute - prev))/60 AS mins FROM (
        SELECT minute, lag(minute) OVER (ORDER BY minute) AS prev FROM ops_minutes WHERE minute >= ${d30}) t
      WHERE prev IS NOT NULL AND minute - prev > interval '3 minutes' ORDER BY minute DESC LIMIT 20`;
    return {
      at: new Date(),
      uptime: { trackedFrom, pct30: +(Math.min(100, (upMin / totalMin) * 100)).toFixed(2), days: minutes, outages },
      traffic: { requests24h: last24[0]?.req ?? 0, errors5xx24h: last24[0]?.e5 ?? 0, avgMs: last24[0]?.req ? Math.round(last24[0].ms / last24[0].req) : 0, maxMs: last24[0]?.max ?? 0, extCalls24h: last24[0]?.ext ?? 0, slowest: slow },
      errors: { count24h: errors, groups: errorsByFp },
      security: { failedLogins24h: failedLogins, deletes24h: auditDeletes, recent: security.map((s) => ({ at: s.at, level: s.level, message: s.message, source: s.source })) },
      jobs: jobs.map((j) => ({ ...j, runs24h: statsBy.get(j.job)?.runs ?? 0, ok24h: statsBy.get(j.job)?.ok ?? 0, avgSecs: statsBy.get(j.job)?.secs ? +Number(statsBy.get(j.job).secs).toFixed(1) : null })),
      email: { ...Object.fromEntries(notif.map((n) => [n.status, n._count._all])), credits: await this.emailCredits() },
      server: this.server(),
      db: dbStats,
      boots: boots.map((b) => b.at),
      deploy: await this.lastDeploy(),
      certs: await this.certs(),
      backups: await this.backups(),
      demo: await this.ping('http://127.0.0.1:3100/health'),
      app: this.appRelease(),
      alerts,
    };
  }

  async events(q: { kind?: string; search?: string; fingerprint?: string; limit?: number }) {
    const where: Prisma.OpsEventWhereInput = {};
    if (q.kind) where.kind = q.kind;
    if (q.fingerprint) where.fingerprint = q.fingerprint;
    if (q.search) where.OR = [{ message: { contains: q.search, mode: 'insensitive' } }, { source: { contains: q.search, mode: 'insensitive' } }];
    return this.prisma.opsEvent.findMany({ where, orderBy: { at: 'desc' }, take: Math.min(500, q.limit ?? 200) });
  }

  async jobHistory(job: string) {
    return this.prisma.opsJobRun.findMany({ where: { job }, orderBy: { startedAt: 'desc' }, take: 100 });
  }

  private server() {
    let memTotal = os.totalmem(), memAvail = os.freemem();
    try {
      const mi = fs.readFileSync('/proc/meminfo', 'utf8');
      const g = (k: string) => Number((mi.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1] || 0) * 1024;
      memTotal = g('MemTotal') || memTotal; memAvail = g('MemAvailable') || memAvail;
    } catch { /* not linux */ }
    let disk = { total: 0, free: 0 };
    try { const s = (fs as any).statfsSync('/'); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { /* old node */ }
    const cpus = os.cpus().length || 1;
    return {
      memPct: Math.round((1 - memAvail / memTotal) * 100), memTotalMb: Math.round(memTotal / 1048576),
      cpuPct: Math.min(100, Math.round((os.loadavg()[0] / cpus) * 100)), load: os.loadavg().map((x) => +x.toFixed(2)), cpus,
      diskPct: disk.total ? Math.round((1 - disk.free / disk.total) * 100) : null, diskFreeGb: disk.total ? +(disk.free / 1073741824).toFixed(1) : null,
      processMb: Math.round(process.memoryUsage().rss / 1048576), processUptimeH: +(process.uptime() / 3600).toFixed(1), hostUptimeD: +(os.uptime() / 86400).toFixed(1),
    };
  }

  private async db() {
    const [r] = await this.prisma.$queryRaw<any[]>`SELECT pg_database_size(current_database())::bigint AS size,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS conns,
      current_setting('max_connections')::int AS max`;
    const big = await this.prisma.$queryRaw<any[]>`SELECT relname AS name, pg_total_relation_size(relid)::bigint AS size FROM pg_stat_user_tables ORDER BY 2 DESC LIMIT 5`;
    return { sizeMb: Math.round(Number(r.size) / 1048576), connections: r.conns, maxConnections: r.max, biggest: big.map((b) => ({ name: b.name, mb: Math.round(Number(b.size) / 1048576) })) };
  }

  private async lastDeploy() {
    const root = path.resolve(process.cwd(), '..', '..');
    try {
      const { stdout } = await run('git', ['-C', root, 'log', '-1', '--format=%h|%cI|%s']);
      const [hash, at, subject] = stdout.trim().split('|');
      return { hash, at, subject };
    } catch { return null; }
  }

  private async certs() {
    const hosts = String(process.env.OPS_CERT_HOSTS || 'erp.logimart.co.in,demo.168-144-77-53.sslip.io').split(',').map((h) => h.trim()).filter(Boolean);
    const one = (host: string) => new Promise<{ host: string; daysLeft: number | null; error?: string }>((resolve) => {
      const sock = tls.connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
        const c = sock.getPeerCertificate(); sock.end();
        resolve({ host, daysLeft: c?.valid_to ? Math.floor((Date.parse(c.valid_to) - Date.now()) / 864e5) : null });
      });
      sock.on('error', (e) => resolve({ host, daysLeft: null, error: e.message }));
      sock.on('timeout', () => { sock.destroy(); resolve({ host, daysLeft: null, error: 'timeout' }); });
    });
    return Promise.all(hosts.map(one));
  }

  private async backups() {
    const dir = process.env.OPS_BACKUP_DIR || '/root/db-backups';
    let local: { file: string; at: Date; mb: number } | null = null;
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.dump')).map((f) => ({ f, st: fs.statSync(path.join(dir, f)) })).sort((a, b) => +b.st.mtime - +a.st.mtime);
      if (files[0]) local = { file: files[0].f, at: files[0].st.mtime, mb: Math.round(files[0].st.size / 1048576) };
    } catch { /* not readable */ }
    const offsite = await this.prisma.opsJobRun.findFirst({ where: { job: 'Off-site backup' }, orderBy: { startedAt: 'desc' } });
    return { local, offsite };
  }

  private appRelease() {
    try { return JSON.parse(fs.readFileSync('/var/www/logimart-downloads/version.json', 'utf8')); } catch { return null; }
  }

  private async ping(url: string) {
    const t = Date.now();
    try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); return { ok: r.ok, ms: Date.now() - t, status: r.status }; }
    catch (e: any) { return { ok: false, ms: Date.now() - t, error: String(e?.message || e) }; }
  }

  // ---------------------------------------------------------------- alerts (email, de-duplicated)

  private async alert(key: string, subject: string, body: string, cooldownH = 6) {
    const since = new Date(Date.now() - cooldownH * 3600_000);
    const recent = await this.prisma.opsEvent.findFirst({ where: { kind: 'alert', fingerprint: `alert:${key}`, at: { gte: since } } });
    if (recent) return;
    this.record({ kind: 'alert', level: 'warn', source: 'ops', message: subject, fingerprint: `alert:${key}` });
    const to = alertTo();
    if (to) await this.mail.sendMail({ to: [to], subject: `[ERP alert] ${subject}`, text: `${body}\n\nOpen the owner console for details.` }).catch(() => false);
  }

  /** Called by the security hooks for things worth an immediate mail (admin login from a new IP). */
  async securityAlert(key: string, subject: string, body: string) { await this.alert(key, subject, body, 12); }

  private async checkAlerts() {
    const now = Date.now();
    const m5 = new Date(now - 5 * MIN);
    const [spike] = await this.prisma.$queryRaw<any[]>`SELECT coalesce(sum(errors5xx),0)::int AS e5 FROM ops_minutes WHERE minute >= ${m5}`;
    if ((spike?.e5 ?? 0) >= 10) await this.alert('5xx-spike', `${spike.e5} server errors in 5 minutes`, 'Users are getting errors right now.', 1);
    const srv = this.server();
    if (srv.memPct >= 88) await this.alert('mem', `Server memory at ${srv.memPct}%`, 'The app may crash or slow down.');
    if ((srv.diskPct ?? 0) >= 85) await this.alert('disk', `Server disk at ${srv.diskPct}%`, `Only ${srv.diskFreeGb} GB free.`);
    const cr = await this.emailCredits();
    if (cr && cr.left < 60) await this.alert('brevo-credits', `Email credits almost gone: ${cr.left} left (Brevo ${cr.plan} plan)`, 'When they run out, MIS, summaries, codes and alerts silently stop going out. Upgrade / top up Brevo.', 12);
    const db = await this.db().catch(() => null);
    if (db && db.connections >= db.maxConnections - 4) await this.alert('dbconn', `Database connections ${db.connections}/${db.maxConnections}`, 'Requests will start waiting / failing.', 2);
    // jobs failing again and again
    const fails = await this.prisma.$queryRaw<any[]>`SELECT job, count(*)::int AS n FROM ops_job_runs WHERE "startedAt" >= ${new Date(now - 3600_000)} AND ok = false GROUP BY job HAVING count(*) >= 3`;
    for (const f of fails) await this.alert(`job:${f.job}`, `${f.job} failing (${f.n}× in the last hour)`, 'Check the job in the console.');
    // scheduled things that should have run
    const ist = new Date(now + 330 * MIN); const hh = ist.getUTCHours(), mm = ist.getUTCMinutes(), dow = ist.getUTCDay();
    const today = new Date(`${ist.toISOString().slice(0, 10)}T00:00:00+05:30`);
    const ranToday = async (job: string) => !!(await this.prisma.opsJobRun.findFirst({ where: { job, startedAt: { gte: today } } }));
    if (String(process.env.CUSTOMER_MIS_AUTOSEND ?? 'true').toLowerCase() !== 'false' && dow !== 0 && (hh > 9 || (hh === 9 && mm >= 40)) && !(await ranToday('Customer MIS'))) await this.alert('mis-missed', 'The 9 AM customer MIS did not run today', 'Customers have not received their MIS.', 12);
    if (hh >= 22 && !(await ranToday('Daily summary')) && String(process.env.DAILY_SUMMARY ?? 'true') !== 'false') await this.alert('summary-missed', 'The 9 PM daily summary did not run', 'Branch heads did not get today’s summary.', 12);
    const off = await this.prisma.opsJobRun.findFirst({ where: { job: 'Off-site backup' }, orderBy: { startedAt: 'desc' } });
    if (off && (now - +off.startedAt > 30 * 3600_000 || !off.ok)) await this.alert('backup', off.ok ? 'No off-site backup in the last 30 hours' : 'Last off-site backup FAILED', String(off.error ?? ''), 12);
    // certificates once a day
    if (hh === 10 && mm < 2) for (const c of await this.certs()) if (c.daysLeft != null && c.daysLeft <= 14) await this.alert(`cert:${c.host}`, `HTTPS certificate for ${c.host} expires in ${c.daysLeft} days`, 'Renewal should be automatic — check certbot.', 24);
  }

  // ---------------------------------------------------------------- retention

  @Cron('40 3 * * *', { timeZone: 'Asia/Kolkata' })
  async prune() {
    const cut = new Date(Date.now() - RETENTION_DAYS * 864e5);
    await this.prisma.opsEvent.deleteMany({ where: { at: { lt: cut } } });
    await this.prisma.opsMinute.deleteMany({ where: { minute: { lt: cut } } });
    await this.prisma.opsJobRun.deleteMany({ where: { startedAt: { lt: cut } } });
  }
}
