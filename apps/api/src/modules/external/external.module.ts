import { Module } from '@nestjs/common';
import { ExternalController } from './external.controller';
import { TrackingService } from '../tracking/tracking.service';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [ShipmentsModule],
  controllers: [ExternalController],
  providers: [TrackingService, ApiKeyGuard],
})
export class ExternalModule {}
