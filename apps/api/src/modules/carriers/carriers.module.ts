import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BluedartModule } from '../bluedart/bluedart.module';
import { DelhiveryModule } from '../delhivery/delhivery.module';
import { XpressBeesModule } from '../xpressbees/xpressbees.module';
import { GatiModule } from '../gati/gati.module';
import { VExpressModule } from '../vexpress/vexpress.module';
import { ArlModule } from '../arlogistics/arl.module';
import { DsCargoModule } from '../dscargo/dscargo.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { BillingModule } from '../billing/billing.module';
import { PincodesModule } from '../pincodes/pincodes.module';
import { RateCalculatorService } from './rate-calculator.service';
import { CarriersController } from './carriers.controller';
import { CarriersService } from './carriers.service';
import { ExceptionsService } from './exceptions.service';

@Module({
  imports: [PrismaModule, BluedartModule, DelhiveryModule, XpressBeesModule, GatiModule, VExpressModule, ArlModule, DsCargoModule, ShipmentsModule, BillingModule, PincodesModule],
  controllers: [CarriersController],
  providers: [CarriersService, ExceptionsService, RateCalculatorService],
})
export class CarriersModule {}
