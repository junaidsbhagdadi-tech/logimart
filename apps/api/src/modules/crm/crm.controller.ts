import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { CrmService } from './crm.service';

@Controller('api/v1')
@UseGuards(RolesGuard)
@Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Post('leads')
  createLead(@Body() dto: any) {
    return this.crm.createLead(dto);
  }

  @Get('leads')
  listLeads() {
    return this.crm.listLeads();
  }

  @Get('leads/pipeline')
  pipeline() {
    return this.crm.pipeline();
  }

  @Patch('leads/:id')
  updateLead(@Param('id') id: string, @Body() dto: any) {
    return this.crm.updateLead(Number(id), dto);
  }

  @Post('leads/:id/quotations')
  addQuotation(@Param('id') id: string, @Body() dto: any) {
    return this.crm.addQuotation(Number(id), dto);
  }
}
