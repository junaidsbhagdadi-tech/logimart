import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { RolesGuard } from '../../common/rbac/roles.guard';

class LoginDto {
  @IsEmail()
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
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** Field-rider login for the mobile app: Rider ID + PIN. */
  @Post('rider-login')
  riderLogin(@Body() dto: RiderLoginDto) {
    return this.auth.riderLogin(dto.riderCode, dto.pin);
  }

  /** Live profile of the logged-in user — the client refreshes access on load, no re-login needed. */
  @Get('me')
  @UseGuards(RolesGuard)
  me(@Req() req: any) {
    return this.auth.me(Number(req.user.sub));
  }
}
