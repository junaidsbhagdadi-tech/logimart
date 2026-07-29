import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { RateService } from './rate.service';
import { InvoiceService } from './invoice.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingController],
  providers: [RateService, InvoiceService],
  exports: [RateService],
})
export class BillingModule {}
