import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { TaxService } from './tax.service';

@Controller('api/v1/tax')
@UseGuards(RolesGuard)
@Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  /** GSTR-1 outward supplies + GSTR-3B summary. */
  @Get('gst')
  gst(@Query('from') from: string, @Query('to') to: string) {
    return this.tax.gst(from, to);
  }

  /** TDS register (receivable from customers + payable on vendors / 26Q). */
  @Get('tds')
  tds(@Query('from') from: string, @Query('to') to: string) {
    return this.tax.tds(from, to);
  }

  /** Tally-import XML (Sales vouchers from invoices). */
  @Get('tally')
  async tally(@Query('from') from: string, @Query('to') to: string, @Res() res: Response) {
    const xml = await this.tax.tallyXml(from, to);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="Tally_Sales_${from}_${to}.xml"`);
    res.send(xml);
  }
}
