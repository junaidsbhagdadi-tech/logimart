import { Module } from '@nestjs/common';
import { BluedartModule } from '../bluedart/bluedart.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [BluedartModule], // isBlueDartVendor — per-account BlueDart vendor codes (476954, 457730 …)
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
