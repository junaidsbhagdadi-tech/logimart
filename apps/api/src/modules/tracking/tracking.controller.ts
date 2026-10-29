import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { clientIp } from '../auth/login-guard';

// Public endpoints (website widgets on logimart.co.in / Tuvas) — cap per IP so the AWB space can't
// be crawled. Single API process, so an in-memory window is enough.
const hits = new Map<string, { n: number; reset: number }>();
function limit(req: any, bucket: string, max: number) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + 60_000 }); if (hits.size > 50_000) hits.clear(); return; }
  if (++h.n > max) throw new HttpException('Too many tracking requests — try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
}

/** Public — no auth guard. Sanitized track-and-trace by AWB / forwarding no / reference. */
@Controller('api/v1/track')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /** Bulk track — up to 50 AWBs at once. */
  @Post('multi')
  trackMany(@Body() dto: { awbs: string[] }, @Req() req: any) {
    limit(req, 'multi', 20);
    return this.tracking.trackMany((dto?.awbs ?? []).slice(0, 50));
  }

  @Get(':awb')
  track(@Param('awb') awb: string, @Req() req: any) {
    limit(req, 'one', 60);
    return this.tracking.track(awb);
  }
}
