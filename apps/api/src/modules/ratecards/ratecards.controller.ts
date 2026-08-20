import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { RateCardsService } from './ratecards.service';
import { CreateRateCardDto, CreateFtlRateDto } from './dto/ratecard.dto';

@Controller('api/v1/rate-cards')
@UseGuards(RolesGuard)
export class RateCardsController {
  constructor(private readonly rateCards: RateCardsService) {}

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  create(@Body() dto: CreateRateCardDto) {
    return this.rateCards.create(dto);
  }

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  list(@Query('clientId') clientId?: string) {
    return this.rateCards.list(clientId ? Number(clientId) : undefined);
  }

  // ---- Revamped customer rate cards (eye → popout) ----
  @Get('cards')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listCards(@Query('clientId') clientId?: string) {
    return this.rateCards.listCards(clientId ? Number(clientId) : undefined);
  }

  @Get('cards/:id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  getCard(@Param('id') id: string) {
    return this.rateCards.getCard(Number(id));
  }

  @Post('cards')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  createCard(@Body() d: any) {
    return this.rateCards.createCard(d);
  }

  @Patch('cards/:id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  updateCard(@Param('id') id: string, @Body() d: any) {
    return this.rateCards.updateCard(Number(id), d);
  }

  @Delete('cards/:id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  removeCard(@Param('id') id: string) {
    return this.rateCards.removeCard(Number(id));
  }

  // ---- FTL rates ----
  @Post('ftl')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  createFtl(@Body() dto: CreateFtlRateDto) {
    return this.rateCards.createFtl(dto);
  }

  @Get('ftl')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listFtl() {
    return this.rateCards.listFtl();
  }
}
