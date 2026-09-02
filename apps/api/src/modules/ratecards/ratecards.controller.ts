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
  listCards(@Query('clientId') clientId?: string, @Query('vendorId') vendorId?: string) {
    return this.rateCards.listCards(clientId ? Number(clientId) : undefined, vendorId ? Number(vendorId) : undefined);
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

  /** Copy this card's accessorial charges to every same-product card (all vendors + SELF) (#10). */
  @Post('cards/:id/copy-charges')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  copyCharges(@Param('id') id: string) {
    return this.rateCards.copyChargesToSiblings(Number(id));
  }

  /** Copy a customer's rate cards (freight + accessorials, × optional % increase) to another customer. */
  @Post('copy')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  copy(@Body() dto: { sourceClientId: number; targetClientId: number; increasePct?: number; round?: boolean }) {
    return this.rateCards.copyRateCards(Number(dto.sourceClientId), Number(dto.targetClientId), Number(dto.increasePct) || 0, !!dto.round);
  }

  /**
   * One-shot bulk rate change — increase/decrease by % or flat ₹ amount, scoped to all customers,
   * a selected set, or a single vendor's cost cards. Optional round-off.
   */
  @Post('increase')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  increase(@Body() dto: { scope: 'ALL' | 'SELECT' | 'VENDOR'; mode?: 'PCT' | 'AMOUNT'; value?: number; increasePct?: number; clientIds?: number[]; vendorId?: number; product?: string; network?: string; round?: boolean; dryRun?: boolean }) {
    return this.rateCards.adjustRateCards({
      scope: dto.scope,
      mode: dto.mode ?? 'PCT',
      value: Number(dto.value ?? dto.increasePct), // back-compat: old callers sent increasePct
      clientIds: (dto.clientIds ?? []).map(Number),
      vendorId: dto.vendorId != null ? Number(dto.vendorId) : undefined,
      product: dto.product,
      network: dto.network,
      round: !!dto.round,
      dryRun: !!dto.dryRun,
    });
  }

  // ---- EDL (ODA) matrix, per vendor/network ----
  @Get('edl')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  listEdl(@Query('network') network?: string) {
    return this.rateCards.listEdl(network || undefined);
  }

  @Post('edl/bulk')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  bulkEdl(@Body() dto: { network: string; rows: any[] }) {
    return this.rateCards.bulkEdl(dto.network || 'SELF', dto.rows ?? []);
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
