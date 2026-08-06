import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { HubsController } from './hubs.controller';
import { HubsService } from './hubs.service';

@Module({ imports: [PrismaModule], controllers: [HubsController], providers: [HubsService] })
export class HubsModule {}
