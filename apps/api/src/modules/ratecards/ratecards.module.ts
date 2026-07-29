import { Module } from '@nestjs/common';
import { RateCardsController } from './ratecards.controller';
import { RateCardsService } from './ratecards.service';

@Module({
  controllers: [RateCardsController],
  providers: [RateCardsService],
})
export class RateCardsModule {}
