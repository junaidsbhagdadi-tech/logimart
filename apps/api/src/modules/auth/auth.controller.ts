import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { clientIp } from './login-guard';
import { RolesGuard } from '../../common/rbac/roles.guard';

class LoginDto {
  // an email, or a username such as a customer's account code
  @IsString()
  @MinLength(2)
  email!: string;

  @IsString()
  @MinLength(4)
  password!: string;
}

class RiderLoginDto {
  @IsString()
  riderCode!: string;

  @IsString()
  @MinLength(4)
  pin!: string;
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.email, dto.password, clientIp(req));
  }

  /** Field-rider login for the mobile app: Rider ID + PIN. */
  @Post('rider-login')
  riderLogin(@Body() dto: RiderLoginDto, @Req() req: any) {
    return this.auth.riderLogin(dto.riderCode, dto.pin, clientIp(req));
  }

  /** Sign-out — recorded for attendance (the token itself just expires client-side). */
  @Post('logout')
  @UseGuards(RolesGuard)
  logout(@Req() req: any, @Body() body: { via?: string }) {
    this.auth.logEvent(BigInt(req.user.sub), 'OUT', clientIp(req), body?.via === 'app' ? 'app' : 'web');
    return { ok: true };
  }

  /** Live profile of the logged-in user — the client refreshes access on load, no re-login needed. */
  @Get('me')
  @UseGuards(RolesGuard)
  me(@Req() req: any) {
    return this.auth.me(Number(req.user.sub));
  }
}
