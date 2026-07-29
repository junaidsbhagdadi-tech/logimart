import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const ACTION: Record<string, string> = { POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' };
// Skip noisy / sensitive paths (auth carries credentials; keep them out of the trail).
const SKIP = [/\/auth\//, /\/uploads/, /\/documents\/\d+\/file/];

/**
 * Append-only audit trail for mutating API calls. Records who (JWT), what (method
 * + path + derived entity), and the resulting HTTP status. Writes are best-effort
 * and never block or fail the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const method: string = req.method;
    const path: string = (req.originalUrl || req.url || '').split('?')[0];

    if (!MUTATING.has(method) || SKIP.some((re) => re.test(path))) return next.handle();

    const write = (status: number) => {
      const u = req.user || {};
      const segs = path.split('/').filter(Boolean); // ['api','v1','clients','5']
      const i = segs.indexOf('v1');
      const entity = i >= 0 ? segs[i + 1] : segs[2];
      const entityId = i >= 0 ? segs[i + 2] : segs[3];
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0];
      this.prisma.auditLog
        .create({
          data: {
            userId: u.sub ? BigInt(u.sub) : null,
            userName: u.email ?? null,
            role: u.role ?? null,
            method,
            path,
            action: ACTION[method] ?? 'other',
            entity: entity ?? null,
            entityId: entityId ?? null,
            status,
            summary: `${method} ${path}`,
            ip: ip || null,
          },
        })
        .catch((e) => this.logger.warn(`audit write failed: ${(e as Error).message}`));
    };

    return next.handle().pipe(
      tap(() => write(ctx.switchToHttp().getResponse()?.statusCode ?? 200)),
      catchError((err) => {
        write(err?.status ?? err?.statusCode ?? 500);
        throw err;
      }),
    );
  }
}
