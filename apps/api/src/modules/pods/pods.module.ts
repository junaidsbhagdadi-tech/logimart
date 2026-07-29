import { Module } from '@nestjs/common';
import { PodsController } from './pods.controller';
import { PodsService } from './pods.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [PodsController],
  providers: [PodsService],
})
export class PodsModule {}
