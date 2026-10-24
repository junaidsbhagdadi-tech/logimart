import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ArlController } from './arl.controller';
import { ArlService } from './arl.service';

@Module({ imports: [PrismaModule], controllers: [ArlController], providers: [ArlService], exports: [ArlService] })
export class ArlModule {}
