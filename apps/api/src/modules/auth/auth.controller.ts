import { Body, Controller, Post } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

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
}
