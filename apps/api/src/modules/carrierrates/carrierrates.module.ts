import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CarrierRatesController } from './carrierrates.controller';
import { CarrierRatesService } from './carrierrates.service';

@Module({ imports: [PrismaModule], controllers: [CarrierRatesController], providers: [CarrierRatesService] })
export class CarrierRatesModule {}
