import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles, Feature } from '../../common/rbac/roles.decorator';
import { ExpensesService, ExpenseInput } from './expenses.service';

@Controller('api/v1/expenses')
@UseGuards(RolesGuard)
@Feature('/expenses')
export class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}

  /** Totals / branch balances / all entries — the financial VIEW. Tagged with its own feature so an
   *  "add-only" data-entry user (granted /expenses EDIT) can record expenses but NOT see the money. */
  @Get()
  @Feature('/expenses-report')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  list(@Query('from') from?: string, @Query('to') to?: string, @Query('branch') branch?: string, @Query('category') category?: string) {
    return this.svc.list({ from, to, branch, category });
  }

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(@Body() dto: ExpenseInput, @Req() req: any) {
    return this.svc.create({ ...dto, createdById: req.user?.sub ? Number(req.user.sub) : undefined });
  }

  @Delete(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  remove(@Param('id') id: string) {
    return this.svc.remove(Number(id));
  }
}
