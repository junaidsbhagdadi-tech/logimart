import { Controller, Get, Param } from '@nestjs/common';
import { TrackingService } from './tracking.service';

/** Public — no auth guard. Sanitized track-and-trace by AWB. */
@Controller('api/v1/track')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':awb')
  track(@Param('awb') awb: string) {
    return this.tracking.track(awb);
  }
}
