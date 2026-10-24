import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { XpressBeesController } from './xpressbees.controller';
import { XpressBeesService } from './xpressbees.service';

@Module({ imports: [PrismaModule], controllers: [XpressBeesController], providers: [XpressBeesService], exports: [XpressBeesService] })
export class XpressBeesModule {}
