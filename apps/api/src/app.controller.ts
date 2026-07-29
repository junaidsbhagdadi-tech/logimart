import { Controller, Get } from '@nestjs/common';
import { COMPANY } from './config/company';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'logimart-erp-api', company: COMPANY.legalName, ts: new Date().toISOString() };
  }
}
