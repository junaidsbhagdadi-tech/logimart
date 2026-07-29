import { Module } from '@nestjs/common';
import { ManifestsController } from './manifests.controller';
import { ManifestsService } from './manifests.service';

@Module({
  controllers: [ManifestsController],
  providers: [ManifestsService],
})
export class ManifestsModule {}
