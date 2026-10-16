import { Module } from '@nestjs/common';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';
import { BluedartModule } from '../bluedart/bluedart.module';

@Module({
  imports: [BluedartModule],
  controllers: [PickupsController],
  providers: [PickupsService],
})
export class PickupsModule {}
