import { Module } from '@nestjs/common';
import { PincodesController } from './pincodes.controller';
import { PincodesService } from './pincodes.service';

@Module({
  controllers: [PincodesController],
  providers: [PincodesService],
})
export class PincodesModule {}
