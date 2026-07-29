import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ComplianceService } from './compliance.service';
import { GenerateEwayDto } from './dto/eway.dto';

@Controller('api/v1/shipments')
@UseGuards(RolesGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** Printable Lorry Receipt / Goods Consignment Note. */
  @Get(':awb/consignment-note')
  consignmentNote(@Param('awb') awb: string) {
    return this.compliance.consignmentNote(awb);
  }

  /** Generate (sandbox) e-way bill for the consignment. */
  @Post(':awb/eway-bill')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  generateEway(@Param('awb') awb: string, @Body() dto: GenerateEwayDto) {
    return this.compliance.generateEwayBill(awb, dto);
  }
}
