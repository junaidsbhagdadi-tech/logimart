import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { LabelsModule } from '../labels/labels.module';
import { BillingModule } from '../billing/billing.module';
import { NotesModule } from '../notes/notes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DelhiveryModule } from '../delhivery/delhivery.module';

@Module({
  imports: [LabelsModule, BillingModule, NotesModule, NotificationsModule, DelhiveryModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
