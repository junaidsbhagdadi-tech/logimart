import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { MastersService } from './masters.service';

@Controller('api/v1/masters')
@UseGuards(RolesGuard)
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get(':type')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.HUB_MANAGER,
    UserRole.WAREHOUSE_HANDLER,
    UserRole.FINANCE_EXEC,
    UserRole.SYS_ADMIN,
    UserRole.DRIVER,
    UserRole.SALES,
  )
  list(@Param('type') type: string, @Req() req: any) {
    // Pickup boys (mobile booking) and Sales need the product list etc. — but only the non-sensitive
    // lists, never COMPANY (bank / invoice series), SETTING or CHARGE rates.
    const limited = req.user?.role === UserRole.DRIVER || req.user?.role === UserRole.SALES;
    if (limited && !['PRODUCT', 'PRODUCT_TYPE', 'ZONE', 'BRANCH', 'CONTENT', 'INSTRUCTION'].includes(String(type).toUpperCase())) {
      throw new ForbiddenException('Not available for your role.');
    }
    return this.masters.list(type);
  }

  @Post(':type')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  save(@Param('type') type: string, @Body() dto: { code: string; name: string; attrs?: any; active?: boolean }) {
    return this.masters.save(type, dto);
  }

  @Delete(':type/:code')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  remove(@Param('type') type: string, @Param('code') code: string) {
    return this.masters.remove(type, code);
  }
}
