import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface CreateUser {
  fullName: string;
  email: string;
  password?: string; // blank → auto-generated + emailed
  role: UserRole;
  hubId?: number;
  clientId?: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private genPassword() {
    // readable temp password, e.g. "Lm-a3f9c1"
    return 'Lm-' + randomBytes(4).toString('hex');
  }

  list() {
    return this.prisma.user.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, fullName: true, email: true, role: true, hubId: true, clientId: true, isActive: true, featureGrants: true },
    });
  }

  async create(dto: CreateUser) {
    // Auto-generate a password when none is supplied, and email the credentials to the new account.
    const autoGen = !(dto.password && dto.password.trim());
    const password = autoGen ? this.genPassword() : dto.password!.trim();
    try {
      const u = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(password, 10),
          role: dto.role,
          hubId: dto.hubId != null ? BigInt(dto.hubId) : null,
          clientId: dto.clientId != null ? BigInt(dto.clientId) : null,
        },
        select: { id: true, fullName: true, email: true, role: true, isActive: true },
      });
      // Send login credentials to the registered email (queued until an email provider is configured).
      const url = process.env.APP_URL ?? 'https://logimart-erp.onrender.com';
      await this.notifications.notify({
        channel: 'email', recipient: u.email, kind: 'account',
        message: `Welcome to LogiMart, ${u.fullName}. Your account is ready.\nLogin: ${url}\nEmail: ${u.email}\nTemporary password: ${password}\nPlease sign in and change your password.`,
      }).catch(() => {});
      // Return the temp password to the admin ONLY when auto-generated, so it can be relayed until email is live.
      return { ...u, tempPassword: autoGen ? password : undefined, credentialsEmailedTo: u.email };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw e;
    }
  }

  /** Toggle active, change role, reset password, or assign feature access (super admin). */
  async update(id: number, dto: { isActive?: boolean; role?: UserRole; password?: string; featureGrants?: string[] | null }) {
    const u = await this.prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!u) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: BigInt(id) },
      data: {
        isActive: dto.isActive,
        role: dto.role,
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
        ...(dto.featureGrants !== undefined ? { featureGrants: dto.featureGrants ?? Prisma.DbNull } : {}),
      },
      select: { id: true, fullName: true, email: true, role: true, isActive: true, featureGrants: true },
    });
  }
}
