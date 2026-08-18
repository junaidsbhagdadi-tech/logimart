import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpscanController } from './opscan.controller';
import { OpscanService } from './opscan.service';

@Module({ imports: [PrismaModule], controllers: [OpscanController], providers: [OpscanService] })
export class OpscanModule {}
