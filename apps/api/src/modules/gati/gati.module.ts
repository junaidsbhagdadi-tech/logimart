import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GatiController } from './gati.controller';
import { GatiService } from './gati.service';

@Module({ imports: [PrismaModule], controllers: [GatiController], providers: [GatiService], exports: [GatiService] })
export class GatiModule {}
