import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

@Module({ imports: [PrismaModule], controllers: [PerformanceController], providers: [PerformanceService], exports: [PerformanceService] })
export class PerformanceModule {}
