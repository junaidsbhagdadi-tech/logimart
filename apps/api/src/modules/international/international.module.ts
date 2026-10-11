import { Module } from '@nestjs/common';
import { InternationalController } from './international.controller';
import { InternationalService } from './international.service';

@Module({
  controllers: [InternationalController],
  providers: [InternationalService],
})
export class InternationalModule {}
