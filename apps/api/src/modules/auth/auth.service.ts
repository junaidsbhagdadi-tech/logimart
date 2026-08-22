import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const payload = {
      sub: user.id.toString(),
      email: user.email,
      role: user.role,
      clientId: user.clientId?.toString() ?? null,
      hubId: user.hubId?.toString() ?? null,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id.toString(),
        fullName: user.fullName,
        role: user.role,
        clientId: user.clientId?.toString() ?? null,
        featureGrants: Array.isArray(user.featureGrants) ? (user.featureGrants as string[]) : null,
      },
    };
  }
}
