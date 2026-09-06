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
import { ROLES_KEY, SUPER_ADMIN_ONLY_KEY, FEATURE_KEY } from './roles.decorator';
import { grantLevelFor, meetsLevel, levelForMethod } from './feature-grants';

/**
 * Verifies the Bearer JWT, attaches the payload to req.user, and enforces any
 * @Roles(...) restriction declared on the handler.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

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
          ? `You don't have access to this feature at the required level. Ask an admin to grant it, or check your department.`
          : `Requires role: ${required.join(' | ')}`,
      );
    }
    return true;
  }
}
