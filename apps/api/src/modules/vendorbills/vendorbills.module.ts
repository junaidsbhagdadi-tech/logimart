import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VendorBillsController } from './vendorbills.controller';
import { VendorBillsService } from './vendorbills.service';

@Module({ imports: [PrismaModule], controllers: [VendorBillsController], providers: [VendorBillsService] })
export class VendorBillsModule {}
