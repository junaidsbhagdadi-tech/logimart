import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Customer-facing API auth: the caller sends `x-api-key: <key>`; we resolve it to an active
 * B2bClient and attach `req.apiClient = { clientId }`. Used only by the external `/api/ext/*`
 * routes — completely separate from the staff JWT RolesGuard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private static cache = new Map<string, { clientId: bigint; exp: number }>();
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = String(req.headers['x-api-key'] || '').trim();
    if (!key) throw new UnauthorizedException('Missing x-api-key header.');
    const now = Date.now();
    const hit = ApiKeyGuard.cache.get(key);
    let clientId = hit && hit.exp > now ? hit.clientId : null;
    if (clientId == null) {
      const c = await this.prisma.b2bClient.findUnique({ where: { apiKey: key }, select: { id: true, isActive: true } });
      if (!c || c.isActive === false) throw new UnauthorizedException('Invalid API key.');
      clientId = c.id;
      ApiKeyGuard.cache.set(key, { clientId, exp: now + 60_000 });
    }
    req.apiClient = { clientId };
    return true;
  }
}
