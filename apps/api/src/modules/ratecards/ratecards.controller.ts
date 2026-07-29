import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
