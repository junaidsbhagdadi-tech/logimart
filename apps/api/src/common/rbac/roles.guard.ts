import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY, SUPER_ADMIN_ONLY_KEY, FEATURE_KEY } from './roles.decorator';
import { grantLevelFor, meetsLevel, levelForMethod } from './feature-grants';

type FreshUser = { role: UserRole; department: string | null; featureGrants: unknown; isActive: boolean } | null;

/**
 * Verifies the Bearer JWT, then resolves the user's CURRENT role / department / feature grants from
 * the database (cached briefly) — NOT from the token — so an access change takes effect immediately
 * without the user re-logging in. Enforces @SuperAdminOnly / @Roles, and admits a request when the
 * user's department or per-user grant covers the route's @Feature at the level the method needs
 * (additive to @Roles).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  // Small process cache so we don't hit the DB on every request; access changes apply within the TTL.
  private static cache = new Map<string, { v: FreshUser; exp: number }>();
  private static TTL_MS = 15_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private async freshUser(sub: unknown): Promise<FreshUser> {
    const id = String(sub ?? '');
    if (!/^\d+$/.test(id)) return null;
    const now = Date.now();
    const hit = RolesGuard.cache.get(id);
    if (hit && hit.exp > now) return hit.v;
    const u = await this.prisma.user
      .findUnique({ where: { id: BigInt(id) }, select: { role: true, department: true, featureGrants: true, isActive: true } })
      .catch(() => null);
    RolesGuard.cache.set(id, { v: (u as FreshUser) ?? null, exp: now + RolesGuard.TTL_MS });
    return (u as FreshUser) ?? null;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      req.user = await this.jwt.verifyAsync(auth.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // Override the token's role/department/grants with the live values from the DB so assignments
    // take effect at once. Deactivated accounts are blocked here regardless of a still-valid token.
    const fresh = await this.freshUser(req.user.sub);
    if (fresh) {
      if (fresh.isActive === false) throw new ForbiddenException('Your account is deactivated.');
      req.user.role = fresh.role;
      req.user.department = fresh.department;
      req.user.featureGrants = fresh.featureGrants;
    }

    const role: UserRole = req.user.role;

    // Routes flagged super-admin-only stay locked to SYS_ADMIN (even for ADMIN).
    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (superOnly) {
      if (role !== UserRole.SYS_ADMIN) throw new ForbiddenException('Super admin only');
      return true;
    }

    // ADMIN inherits all non-super-only access (everything ops/billing/masters).
    if (role === UserRole.ADMIN) return true;

    // Feature-grant access (department / per-user grants) — ADDITIVE to @Roles. If the route is tied
    // to a feature and the user's grant covers it at the level the HTTP method needs, admit them even
    // if their role wouldn't. This is what makes "grant a user the Customers feature" actually work.
    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (feature && meetsLevel(grantLevelFor(req.user, feature), levelForMethod(req.method))) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    if (!required.includes(role)) {
      throw new ForbiddenException(
        feature
          ? `No access to ${feature}. You are role ${role}${req.user.department ? `, department ${req.user.department}` : ' (no department)'}; your granted level is ${grantLevelFor(req.user, feature) ?? 'none'} but this action needs ${levelForMethod(req.method)}. Ask an admin to grant ${feature} at ${levelForMethod(req.method)} or higher.`
          : `Requires role: ${required.join(' | ')}`,
      );
    }
    return true;
  }
}
