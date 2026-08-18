import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MastersController } from './masters.controller';
import { MastersService } from './masters.service';

@Module({ imports: [PrismaModule], controllers: [MastersController], providers: [MastersService] })
export class MastersModule {}
