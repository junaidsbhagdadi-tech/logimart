import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TrackingService } from './tracking.service';

/** Public — no auth guard. Sanitized track-and-trace by AWB. */
@Controller('api/v1/track')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /** Bulk track — many AWBs at once. */
  @Post('multi')
  trackMany(@Body() dto: { awbs: string[] }) {
    return this.tracking.trackMany(dto?.awbs ?? []);
  }

  @Get(':awb')
  track(@Param('awb') awb: string) {
    return this.tracking.track(awb);
  }
}
