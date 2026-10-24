import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DsCargoController } from './dscargo.controller';
import { DsCargoService } from './dscargo.service';

@Module({ imports: [PrismaModule], controllers: [DsCargoController], providers: [DsCargoService], exports: [DsCargoService] })
export class DsCargoModule {}
