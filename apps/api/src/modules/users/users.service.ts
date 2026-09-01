import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Department, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface CreateUser {
  fullName: string;
  email: string;
  password?: string; // blank → auto-generated + emailed
  role: UserRole;
  department?: Department | null;
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
      select: { id: true, fullName: true, email: true, role: true, department: true, hubId: true, clientId: true, isActive: true, featureGrants: true },
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
          department: dto.department ?? null,
          hubId: dto.hubId != null ? BigInt(dto.hubId) : null,
          clientId: dto.clientId != null ? BigInt(dto.clientId) : null,
        },
        select: { id: true, fullName: true, email: true, role: true, department: true, isActive: true },
      });
      // Send login credentials to the registered email (queued until an email provider is configured).
      const url = process.env.APP_URL ?? 'https://erp.logimart.co.in';
      await this.notifications.notify({
        channel: 'email', recipient: u.email, kind: 'account',
        message: `Welcome to LogiMart, ${u.fullName}. Your account is ready.\nLogin: ${url}\nEmail: ${u.email}\nTemporary password: ${password}\nPlease sign in and change your password.`,
      }).catch(() => {});
      // Return the temp password to the admin ONLY when auto-generated, so it can be relayed until email is live.
      return { ...u, tempPassword: autoGen ? password : undefined, credentialsEmailedTo: u.email, loginUrl: url };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw e;
    }
  }

  /** Hard-delete a user. Can't delete yourself; if the user has recorded activity (scans/PODs),
   *  detach it first so history survives, then remove the login. */
  async remove(id: number, actingUserId?: number) {
    if (actingUserId != null && Number(id) === Number(actingUserId)) {
      throw new ConflictException('You cannot delete your own account.');
    }
    const u = await this.prisma.user.findUnique({ where: { id: BigInt(id) }, select: { id: true } });
    if (!u) throw new NotFoundException('User not found');
    // A user who has scanned/delivered can't be hard-deleted (audit trail is non-nullable) — deactivate instead.
    const [scans, pods] = await Promise.all([
      this.prisma.scanEvent.count({ where: { scannedById: BigInt(id) } }),
      this.prisma.pod.count({ where: { deliveredById: BigInt(id) } }),
    ]);
    if (scans > 0 || pods > 0) {
      throw new ConflictException(`This user has recorded activity (${scans} scan(s), ${pods} POD(s)) — deactivate it instead of deleting, to keep the audit trail.`);
    }
    await this.prisma.scanLog.updateMany({ where: { scannedById: BigInt(id) }, data: { scannedById: null } }).catch(() => {});
    await this.prisma.user.delete({ where: { id: BigInt(id) } });
    return { ok: true, id };
  }

  /** Auto-generate a fresh temp password, set it, email it, and return it so the admin can relay it. */
  async resetPassword(id: number) {
    const u = await this.prisma.user.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, email: true, fullName: true },
    });
    if (!u) throw new NotFoundException('User not found');
    const password = this.genPassword();
    await this.prisma.user.update({ where: { id: BigInt(id) }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    const loginUrl = process.env.APP_URL ?? 'https://erp.logimart.co.in';
    await this.notifications.notify({
      channel: 'email', recipient: u.email, kind: 'account',
      message: `Your LogiMart password was reset, ${u.fullName}.\nLogin: ${loginUrl}\nEmail: ${u.email}\nTemporary password: ${password}\nPlease sign in and change your password.`,
    }).catch(() => {});
    return { tempPassword: password, email: u.email, loginUrl };
  }

  /** Toggle active, change role, reset password, or assign feature access (super admin). */
  async update(id: number, dto: { isActive?: boolean; role?: UserRole; department?: Department | null; password?: string; featureGrants?: string[] | Record<string, string> | null }) {
    const u = await this.prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!u) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: BigInt(id) },
      data: {
        isActive: dto.isActive,
        role: dto.role,
        ...(dto.department !== undefined ? { department: dto.department ?? null } : {}),
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
        ...(dto.featureGrants !== undefined ? { featureGrants: dto.featureGrants ?? Prisma.DbNull } : {}),
      },
      select: { id: true, fullName: true, email: true, role: true, department: true, isActive: true, featureGrants: true },
    });
  }
}
