import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { AdminService } from './admin.service';

@Controller('api/v1/admin')
@UseGuards(RolesGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Wipe test/transactional data for a clean UAT slate. SYS_ADMIN only. */
  @Post('clear-test-data')
  @Roles(UserRole.SYS_ADMIN)
  clearTestData() {
    return this.admin.clearTestData();
  }

  /** Purge ONE customer's transactional + rate data (keeps the customer). SYS_ADMIN only. */
  @Post('clear-client/:clientId')
  @Roles(UserRole.SYS_ADMIN)
  clearClient(@Param('clientId') clientId: string) {
    return this.admin.clearClient(Number(clientId));
  }
}
