import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PerBoxController } from './per-box.controller';
import { RateService } from './rate.service';
import { PerBoxService } from './per-box.service';
import { InvoiceService } from './invoice.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingController, PerBoxController],
  providers: [RateService, PerBoxService, InvoiceService],
  exports: [RateService],
})
export class BillingModule {}
