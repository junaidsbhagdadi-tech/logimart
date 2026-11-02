import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { XpressBeesController, XpressBeesWebhookController } from './xpressbees.controller';
import { XpressBeesService } from './xpressbees.service';

@Module({ imports: [PrismaModule], controllers: [XpressBeesController, XpressBeesWebhookController], providers: [XpressBeesService], exports: [XpressBeesService] })
export class XpressBeesModule {}
