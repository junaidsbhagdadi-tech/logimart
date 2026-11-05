import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginGuard } from './login-guard';
import { isOpsOwnerEmail, opsAlert, opsRecord } from '../../common/ops-hooks';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Sign in with an email OR a username (e.g. a customer's account code). */
  async login(email: string, password: string, ip = 'unknown') {
    const id = String(email || '').trim();
    const key = `email:${id.toLowerCase()}`;
    LoginGuard.assertAllowed(key, ip);
    const user = id.includes('@')
      ? await this.prisma.user.findFirst({ where: { email: { equals: id, mode: 'insensitive' } } })
      : await this.prisma.user.findUnique({ where: { username: id.toUpperCase() } });
    const ok = !!user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!ok || !user) {
      LoginGuard.failed(key, ip);
      throw new UnauthorizedException('Invalid credentials');
    }
    LoginGuard.succeeded(key);
    if (['SYS_ADMIN', 'ADMIN'].includes(user.role) || isOpsOwnerEmail(user.email)) await this.watchAdminIp(user, ip);
    this.logEvent(user.id, 'IN', ip, 'web');
    return this.issue(user);
  }

  /** Owner console: an admin signing in from a network never seen for them before is worth an email. */
  private async watchAdminIp(user: { id: bigint; email: string; fullName: string; role: string }, ip: string) {
    try {
      const seen = await this.prisma.loginLog.findFirst({ where: { userId: user.id, ip }, select: { id: true } });
      const any = await this.prisma.loginLog.findFirst({ where: { userId: user.id }, select: { id: true } });
      opsRecord({ kind: 'security', level: seen ? 'info' : 'warn', source: 'login', message: `${user.role} login: ${user.fullName} (${user.email}) from ${ip}${seen ? '' : ' — NEW network'}`, fingerprint: seen ? 'login:admin' : 'login:admin-newip', userId: user.id });
      // Mobile-data networks change daily, so only SYS_ADMIN / owner logins are e-mailed; other admins show in the Security tab.
      if (!seen && any && (user.role === 'SYS_ADMIN' || isOpsOwnerEmail(user.email))) opsAlert(`newip:${user.id}:${ip}`, `${user.role} login from a new network: ${user.fullName}`, `${user.fullName} (${user.email}) signed in from ${ip}, which hasn't been used for this login before.
If this wasn't expected, change the password and check the console.`);
    } catch { /* never block a login */ }
  }

  /** Attendance trail: one row per sign-in / sign-out (never blocks the login). */
  logEvent(userId: bigint, kind: 'IN' | 'OUT', ip?: string, via?: string) {
    this.prisma.loginLog.create({ data: { userId, kind, ip: ip ?? null, via: via ?? null } }).catch(() => {});
  }

  /** Mobile-app login for field riders: Rider ID (e.g. RID001) + numeric PIN. */
  async riderLogin(riderCode: string, pin: string, ip = 'unknown') {
    const code = (riderCode || '').trim().toUpperCase();
    const key = `rider:${code}`;
    LoginGuard.assertAllowed(key, ip);
    const user = await this.prisma.user.findUnique({ where: { riderCode: code } });
    const ok = !!user && user.isActive && user.role === 'DRIVER' && !!user.pinHash && (await bcrypt.compare(pin, user.pinHash));
    if (!ok || !user) {
      LoginGuard.failed(key, ip);
      throw new UnauthorizedException('Invalid Rider ID or PIN');
    }
    LoginGuard.succeeded(key);
    this.logEvent(user.id, 'IN', ip, 'app');
    return this.issue(user);
  }

  /** Portal opt-in flags from the linked customer (CLIENT_ADMIN) so the UI can gate My Invoices /
   *  rate-check. Internal staff (no clientId) get both false; they're governed by role, not these. */
  private async clientFlags(clientId: bigint | null) {
    if (clientId == null) return { canViewInvoices: false, canCheckRates: false, canSeePerformance: false };
    const c = await this.prisma.b2bClient.findUnique({ where: { id: clientId }, select: { canViewInvoices: true, canCheckRates: true, canSeePerformance: true } }).catch(() => null);
    return { canViewInvoices: !!c?.canViewInvoices, canCheckRates: !!c?.canCheckRates, canSeePerformance: !!c?.canSeePerformance };
  }

  /** Current user's LIVE profile (role / department / feature grants) so the client can refresh
   *  access on load without re-logging in. Same shape as the login `user`. */
  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(userId) } });
    if (!user || !user.isActive) throw new UnauthorizedException('Session no longer valid — sign in again.');
    const flags = await this.clientFlags(user.clientId);
    return {
      id: user.id.toString(),
      fullName: user.fullName,
      role: user.role,
      clientId: user.clientId?.toString() ?? null,
      riderCode: user.riderCode ?? null,
      department: user.department ?? null,
      ...flags,
      isOpsOwner: isOpsOwnerEmail(user.email),
      featureGrants:
        Array.isArray(user.featureGrants) || (user.featureGrants && typeof user.featureGrants === 'object')
          ? (user.featureGrants as any)
          : null,
    };
  }

  /** Build the JWT + user summary returned by every login path. */
  private async issue(user: {
    id: bigint; email: string; role: UserRole; clientId: bigint | null; hubId: bigint | null;
    fullName: string; featureGrants: unknown; department?: string | null; riderCode?: string | null;
  }) {
    const payload = {
      sub: user.id.toString(),
      email: user.email,
      role: user.role,
      clientId: user.clientId?.toString() ?? null,
      hubId: user.hubId?.toString() ?? null,
      // Carried into the token so RolesGuard can honour department / per-user feature grants
      // server-side (not just in the UI). Users must re-login after an access change to refresh these.
      department: user.department ?? null,
      featureGrants:
        Array.isArray(user.featureGrants) || (user.featureGrants && typeof user.featureGrants === 'object')
          ? (user.featureGrants as any)
          : null,
    };
    const flags = await this.clientFlags(user.clientId);
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id.toString(),
        fullName: user.fullName,
        role: user.role,
        clientId: user.clientId?.toString() ?? null,
        riderCode: user.riderCode ?? null,
        department: user.department ?? null,
        ...flags,
        isOpsOwner: isOpsOwnerEmail(user.email),
        // Pass through either grant shape (legacy string[] OR { route: level } map) so a per-user
        // override actually reaches the client; null/other → department/role defaults apply.
        featureGrants:
          Array.isArray(user.featureGrants) || (user.featureGrants && typeof user.featureGrants === 'object')
            ? (user.featureGrants as any)
            : null,
      },
    };
  }
}
