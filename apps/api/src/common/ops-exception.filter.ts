import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { opsRecord } from './ops-hooks';

/**
 * Records every server error (5xx / unexpected exception) for the owner console with its stack, the
 * route and the user, then lets Nest answer exactly as before. 4xx (validation, not found, forbidden)
 * are normal traffic and are only counted, not stored.
 */
@Catch()
export class OpsExceptionFilter extends BaseExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    try {
      const status = exception instanceof HttpException ? exception.getStatus() : 500;
      if (status >= 500 && host.getType() === 'http') {
        const req = host.switchToHttp().getRequest();
        const p = String(req?.originalUrl || req?.url || '').split('?')[0].replace(/(\/webhooks\/[^/]+\/)[^/]+/, '$1:secret');
        const route = p.replace(/\/\d{3,}/g, '/:id').replace(/\/[A-Z]{1,4}\d{6,}/g, '/:awb');
        const msg = String(exception?.message || exception).slice(0, 500);
        opsRecord({
          kind: 'error', level: 'error', source: `${req?.method} ${route}`.slice(0, 190), message: msg,
          fingerprint: `${req?.method} ${route} :: ${msg.slice(0, 80)}`,
          userId: req?.user?.sub ?? null,
          detail: { status, path: p, stack: String(exception?.stack || '').slice(0, 4000), user: req?.user?.email ?? null },
        });
      }
    } catch { /* never let monitoring change the response */ }
    super.catch(exception, host);
  }
}
