import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VExpressController } from './vexpress.controller';
import { VExpressService } from './vexpress.service';

@Module({ imports: [PrismaModule], controllers: [VExpressController], providers: [VExpressService], exports: [VExpressService] })
export class VExpressModule {}
