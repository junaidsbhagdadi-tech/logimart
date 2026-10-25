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
import { CarriersController } from './carriers.controller';
import { CarriersService } from './carriers.service';
import { ExceptionsService } from './exceptions.service';

@Module({
  imports: [PrismaModule, BluedartModule, DelhiveryModule, XpressBeesModule, GatiModule, VExpressModule, ArlModule, DsCargoModule, ShipmentsModule],
  controllers: [CarriersController],
  providers: [CarriersService, ExceptionsService],
})
export class CarriersModule {}
