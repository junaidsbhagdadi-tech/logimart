import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RateMatrixController } from './ratematrix.controller';
import { RateMatrixService } from './ratematrix.service';

@Module({ imports: [PrismaModule], controllers: [RateMatrixController], providers: [RateMatrixService] })
export class RateMatrixModule {}
