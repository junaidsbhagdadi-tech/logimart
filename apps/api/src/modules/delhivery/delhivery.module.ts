import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DelhiveryController } from './delhivery.controller';
import { DelhiveryService } from './delhivery.service';

@Module({ imports: [PrismaModule], controllers: [DelhiveryController], providers: [DelhiveryService] })
export class DelhiveryModule {}
