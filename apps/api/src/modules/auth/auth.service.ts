import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
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
    return this.issue(user);
  }

  /** Mobile-app login for field riders: Rider ID (e.g. RID001) + numeric PIN. */
  async riderLogin(riderCode: string, pin: string) {
    const code = (riderCode || '').trim().toUpperCase();
    const user = await this.prisma.user.findUnique({ where: { riderCode: code } });
    if (!user || !user.isActive || user.role !== 'DRIVER' || !user.pinHash) {
      throw new UnauthorizedException('Invalid Rider ID or PIN');
    }
    const ok = await bcrypt.compare(pin, user.pinHash);
    if (!ok) throw new UnauthorizedException('Invalid Rider ID or PIN');
    return this.issue(user);
  }

  /** Build the JWT + user summary returned by every login path. */
  private async issue(user: {
    id: bigint; email: string; role: UserRole; clientId: bigint | null; hubId: bigint | null;
    fullName: string; featureGrants: unknown; department?: string | null; riderCode?: string | null;
  }) {
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
        riderCode: user.riderCode ?? null,
        department: user.department ?? null,
        // Pass through either grant shape (legacy string[] OR { route: level } map) so a per-user
        // override actually reaches the client; null/other → department/role defaults apply.
        featureGrants:
          Array.isArray(user.featureGrants) || (user.featureGrants && typeof user.featureGrants === 'object')
            ? (user.featureGrants as any)
            : null,
      },
    };
  }
}
