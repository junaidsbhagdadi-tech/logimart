import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Brute-force protection for the login endpoints (staff email/password and rider ID/PIN). Rider IDs are
 * sequential and PINs short, so unlimited guessing would find a PIN in minutes.
 *  - per account: 5 wrong tries within 15 min → that account is locked for 15 min (a success clears it)
 *  - per client IP: 30 wrong tries within 15 min → that IP is blocked for 15 min (any account)
 * In-memory: the Logimart API runs as ONE pm2 process (fork mode). A restart clears the counters, which only
 * ever errs towards letting a real user back in.
 */
const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_MAX = 5;
const IP_MAX = 30;

type Entry = { fails: number; first: number; lockedUntil: number };
const accounts = new Map<string, Entry>();
const ips = new Map<string, Entry>();

function check(map: Map<string, Entry>, key: string, what: string) {
  const e = map.get(key);
  if (!e) return;
  const now = Date.now();
  if (e.lockedUntil > now) {
    const mins = Math.ceil((e.lockedUntil - now) / 60000);
    throw new HttpException(`Too many wrong attempts${what}. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (now - e.first > WINDOW_MS) map.delete(key);
}

function fail(map: Map<string, Entry>, key: string, max: number) {
  const now = Date.now();
  let e = map.get(key);
  if (!e || now - e.first > WINDOW_MS) e = { fails: 0, first: now, lockedUntil: 0 };
  e.fails += 1;
  if (e.fails >= max) e.lockedUntil = now + WINDOW_MS;
  map.set(key, e);
}

export const LoginGuard = {
  /** Throws 429 if this account or IP is currently locked. */
  assertAllowed(account: string, ip: string) {
    check(ips, ip, ' from this network');
    check(accounts, account, ' for this login');
  },
  failed(account: string, ip: string) {
    fail(accounts, account, ACCOUNT_MAX);
    fail(ips, ip, IP_MAX);
  },
  succeeded(account: string) {
    accounts.delete(account);
  },
};

/** The real client IP: nginx overwrites X-Real-IP with $remote_addr (X-Forwarded-For's first hop is
 *  client-supplied, so it is NOT trusted here). Falls back to the socket address. */
export function clientIp(req: any): string {
  return String(req?.headers?.['x-real-ip'] || req?.ip || req?.socket?.remoteAddress || 'unknown').trim();
}
