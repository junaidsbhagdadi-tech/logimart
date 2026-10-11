import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { InternationalService, IntlInput } from './international.service';

const OPS = [UserRole.HUB_MANAGER, UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN];
const FIN = [UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN];

@Controller('api/v1/intl')
@UseGuards(RolesGuard)
export class InternationalController {
  constructor(private readonly intl: InternationalService) {}

  // ---- rate cards (declared before ':idOrJob' so the literal path wins) ----
  @Get('rate-cards')
  @Roles(...OPS)
  listCards(@Query('mode') mode?: string, @Query('clientId') clientId?: string) {
    return this.intl.listCards({ mode, clientId: clientId ? Number(clientId) : undefined });
  }

  @Post('rate-cards')
  @Roles(...FIN)
  upsertCard(@Body() dto: any) {
    return this.intl.upsertCard(dto);
  }

  @Delete('rate-cards/:id')
  @Roles(...FIN)
  deleteCard(@Param('id') id: string) {
    return this.intl.deleteCard(Number(id));
  }

  // ---- rating ----
  @Post('quote')
  @Roles(...OPS)
  quote(@Body() dto: any) {
    return this.intl.quote(dto);
  }

  // ---- charges (literal before ':idOrJob') ----
  @Delete('charges/:chargeId')
  @Roles(...FIN)
  deleteCharge(@Param('chargeId') chargeId: string) {
    return this.intl.deleteCharge(Number(chargeId));
  }

  // ---- shipments CRUD ----
  @Post()
  @Roles(...OPS)
  create(@Body() dto: IntlInput, @Req() req: any) {
    return this.intl.create(dto, req.user?.sub ? Number(req.user.sub) : undefined);
  }

  @Get()
  @Roles(...OPS)
  list(@Query('mode') mode?: string, @Query('status') status?: string, @Query('clientId') clientId?: string, @Query('q') q?: string, @Query('limit') limit?: string) {
    return this.intl.list({ mode, status, clientId: clientId ? Number(clientId) : undefined, q, limit: limit ? Number(limit) : undefined });
  }

  @Post(':id/update')
  @Roles(...OPS)
  update(@Param('id') id: string, @Body() dto: Partial<IntlInput>) {
    return this.intl.update(Number(id), dto);
  }

  @Post(':id/status')
  @Roles(...OPS)
  setStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.intl.setStatus(Number(id), body?.status);
  }

  @Post(':id/cancel')
  @Roles(...OPS)
  cancel(@Param('id') id: string) {
    return this.intl.cancel(Number(id));
  }

  @Get(':id/charges')
  @Roles(...OPS)
  listCharges(@Param('id') id: string) {
    return this.intl.listCharges(Number(id));
  }

  @Post(':id/charges')
  @Roles(...FIN)
  addCharge(@Param('id') id: string, @Body() dto: { code?: string; name: string; amount: number; currency?: string; taxable?: boolean }) {
    return this.intl.addCharge(Number(id), dto);
  }

  @Get(':idOrJob/document')
  @Roles(...OPS)
  document(@Param('idOrJob') idOrJob: string) {
    return this.intl.docData(idOrJob);
  }

  @Get(':idOrJob')
  @Roles(...OPS)
  get(@Param('idOrJob') idOrJob: string) {
    return this.intl.get(idOrJob);
  }
}
