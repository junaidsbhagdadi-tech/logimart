import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginGuard } from './login-guard';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, ip = 'unknown') {
    const key = `email:${String(email || '').trim().toLowerCase()}`;
    LoginGuard.assertAllowed(key, ip);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = !!user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!ok || !user) {
      LoginGuard.failed(key, ip);
      throw new UnauthorizedException('Invalid credentials');
    }
    LoginGuard.succeeded(key);
    return this.issue(user);
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
    return this.issue(user);
  }

  /** Portal opt-in flags from the linked customer (CLIENT_ADMIN) so the UI can gate My Invoices /
   *  rate-check. Internal staff (no clientId) get both false; they're governed by role, not these. */
  private async clientFlags(clientId: bigint | null) {
    if (clientId == null) return { canViewInvoices: false, canCheckRates: false };
    const c = await this.prisma.b2bClient.findUnique({ where: { id: clientId }, select: { canViewInvoices: true, canCheckRates: true } }).catch(() => null);
    return { canViewInvoices: !!c?.canViewInvoices, canCheckRates: !!c?.canCheckRates };
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
