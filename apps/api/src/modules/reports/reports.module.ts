import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [PrismaModule, NotificationsModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
