import { Controller, Get, Param, Query } from '@nestjs/common';
import { PincodesService } from './pincodes.service';

// Public-ish master data (no role gate) — needed during booking by any staff/client.
@Controller('api/v1/pincodes')
export class PincodesController {
  constructor(private readonly pincodes: PincodesService) {}

  @Get('search')
  search(@Query('q') q: string) {
    return this.pincodes.search(q ?? '');
  }

  @Get(':pincode')
  lookup(@Param('pincode') pincode: string) {
    return this.pincodes.lookup(pincode);
  }
}
