import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CustomerMisService } from './customer-mis.service';
import { DailySummaryService } from './daily-summary.service';
import { BillingModule } from '../billing/billing.module';

@Module({ imports: [PrismaModule, NotificationsModule, BillingModule], controllers: [ReportsController], providers: [ReportsService, CustomerMisService, DailySummaryService] })
export class ReportsModule {}
