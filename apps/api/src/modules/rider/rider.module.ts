import { Module } from '@nestjs/common';
import { RiderController } from './rider.controller';

@Module({
  controllers: [RiderController],
})
export class RiderModule {}
