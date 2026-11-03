import { Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { clientIp } from '../auth/login-guard';
import { OpsService } from './ops.service';

/**
 * Owner console. Every route needs a normal ERP login whose email is in OPS_OWNER_EMAILS (server .env);
 * the data routes additionally need the X-Ops-Token issued after the emailed one-time code. Anyone else
 * gets a plain 404 — the console doesn't advertise that it exists.
 */
@Controller('api/v1/ops')
@UseGuards(RolesGuard)
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  private async gate(req: any, token?: string) {
    if (!(await this.ops.isOwnerUser(req.user?.sub))) throw new NotFoundException();
    if (token !== undefined) this.ops.assertToken(req.user.sub, token);
  }

  @Post('otp/request')
  async request(@Req() req: any) {
    await this.gate(req);
    return this.ops.requestCode(req.user.sub);
  }

  @Post('otp/verify')
  async verify(@Req() req: any, @Body() body: { code?: string }) {
    await this.gate(req);
    return this.ops.verifyCode(req.user.sub, String(body?.code ?? ''), clientIp(req));
  }

  @Get('overview')
  async overview(@Req() req: any, @Headers('x-ops-token') token = '') {
    await this.gate(req, token);
    return this.ops.overview();
  }

  @Get('events')
  async events(@Req() req: any, @Headers('x-ops-token') token = '', @Query('kind') kind?: string, @Query('search') search?: string, @Query('fingerprint') fingerprint?: string, @Query('limit') limit?: string) {
    await this.gate(req, token);
    return this.ops.events({ kind, search, fingerprint, limit: limit ? Number(limit) : undefined });
  }

  @Get('jobs/:name')
  async job(@Req() req: any, @Headers('x-ops-token') token = '', @Param('name') name: string) {
    await this.gate(req, token);
    return this.ops.jobHistory(name);
  }

  // ---- one-click fixes (owner token required) ----
  @Post('actions/run')
  async runJob(@Req() req: any, @Headers('x-ops-token') token = '', @Body() body: { job?: string }) {
    await this.gate(req, token);
    return this.ops.runJob(String(body?.job ?? ''));
  }

  @Post('actions/unlock')
  async unlock(@Req() req: any, @Headers('x-ops-token') token = '', @Body() body: { key?: string }) {
    await this.gate(req, token);
    return this.ops.unlockLogin(String(body?.key ?? ''));
  }

  @Post('actions/mute')
  async mute(@Req() req: any, @Headers('x-ops-token') token = '', @Body() body: { id?: string; hours?: number }) {
    await this.gate(req, token);
    return this.ops.mute(String(body?.id ?? ''), Number(body?.hours) || 24);
  }

  @Post('actions/restart')
  async restart(@Req() req: any, @Headers('x-ops-token') token = '') {
    await this.gate(req, token);
    return this.ops.restartApp();
  }

  /** Send a test alert email so the owner knows the alert path works. */
  @Post('test-alert')
  async testAlert(@Req() req: any, @Headers('x-ops-token') token = '') {
    await this.gate(req, token);
    return this.ops.testAlert();
  }
}
