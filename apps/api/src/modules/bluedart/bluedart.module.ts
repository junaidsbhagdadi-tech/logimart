import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BluedartController, BluedartPushController } from './bluedart.controller';
import { BluedartService } from './bluedart.service';

@Module({ imports: [PrismaModule], controllers: [BluedartController, BluedartPushController], providers: [BluedartService], exports: [BluedartService] })
export class BluedartModule {}
