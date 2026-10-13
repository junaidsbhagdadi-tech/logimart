import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BluedartController } from './bluedart.controller';
import { BluedartService } from './bluedart.service';

@Module({ imports: [PrismaModule], controllers: [BluedartController], providers: [BluedartService], exports: [BluedartService] })
export class BluedartModule {}
