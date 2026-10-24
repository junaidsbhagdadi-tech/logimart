import { Module } from '@nestjs/common';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';
import { BluedartModule } from '../bluedart/bluedart.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { XpressBeesModule } from '../xpressbees/xpressbees.module';

@Module({
  imports: [BluedartModule, ShipmentsModule, XpressBeesModule], // ShipmentsService: mark-picked books the billable shipment
  controllers: [PickupsController],
  providers: [PickupsService],
})
export class PickupsModule {}
