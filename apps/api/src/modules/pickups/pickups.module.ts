import { Module } from '@nestjs/common';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';

@Module({
  controllers: [PickupsController],
  providers: [PickupsService],
})
export class PickupsModule {}
