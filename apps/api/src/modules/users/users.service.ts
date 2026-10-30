import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Department, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface CreateUser {
  fullName: string;
  email?: string;
  username?: string; // alternative login id — e.g. the customer's account code
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
      select: { id: true, fullName: true, email: true, username: true, role: true, department: true, hubId: true, clientId: true, isActive: true, featureGrants: true, branches: true, companyCodes: true, createdAt: true },
    });
  }

  /** Placeholder address for a username-only login (email is required + unique in the schema). */
  static noEmail(username: string) { return `${username.toLowerCase()}@no-email.logimart.co.in`; }
  static isPlaceholder(email?: string | null) { return /@no-email\.logimart\.co\.in$/i.test(String(email ?? '')); }

  async create(dto: CreateUser) {
    // Auto-generate a password when none is supplied, and email the credentials to the new account.
    const autoGen = !(dto.password && dto.password.trim());
    const password = autoGen ? this.genPassword() : dto.password!.trim();
    const username = String(dto.username ?? '').trim().toUpperCase() || null;
    const realEmail = String(dto.email ?? '').trim().toLowerCase();
    if (!realEmail && !username) throw new BadRequestException('Give an email or a username.');
    if (username && (username.includes('@') || /\s/.test(username))) throw new BadRequestException('A username can\'t contain spaces or "@".');
    try {
      const u = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          email: realEmail || UsersService.noEmail(username!),
          username,
          passwordHash: await bcrypt.hash(password, 10),
          role: dto.role,
          department: dto.department ?? null,
          hubId: dto.hubId != null ? BigInt(dto.hubId) : null,
          clientId: dto.clientId != null ? BigInt(dto.clientId) : null,
        },
        select: { id: true, fullName: true, email: true, username: true, role: true, department: true, isActive: true },
      });
      // Send login credentials to the registered email (queued until an email provider is configured).
      const url = process.env.APP_URL ?? 'https://erp.logimart.co.in';
      const loginId = u.username ?? u.email;
      if (realEmail) {
        await this.notifications.notify({
          channel: 'email', recipient: u.email, kind: 'account',
          message: `Welcome to LogiMart, ${u.fullName}. Your account is ready.\nLogin: ${url}\nUsername: ${loginId}\nTemporary password: ${password}\nPlease sign in and change your password.`,
        }).catch(() => {});
      }
      // Return the temp password to the admin ONLY when auto-generated, so it can be relayed until email is live.
      return { ...u, email: realEmail || null, loginId, tempPassword: autoGen ? password : undefined, credentialsEmailedTo: realEmail || null, loginUrl: url };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(String((e.meta as any)?.target ?? '').includes('username') ? 'That username is already taken' : 'Email already in use');
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
      select: { id: true, email: true, username: true, fullName: true },
    });
    if (!u) throw new NotFoundException('User not found');
    const password = this.genPassword();
    await this.prisma.user.update({ where: { id: BigInt(id) }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    const loginUrl = process.env.APP_URL ?? 'https://erp.logimart.co.in';
    if (UsersService.isPlaceholder(u.email)) return { tempPassword: password, email: u.username ?? u.email, loginUrl };
    await this.notifications.notify({
      channel: 'email', recipient: u.email, kind: 'account',
      message: `Your LogiMart password was reset, ${u.fullName}.\nLogin: ${loginUrl}\nEmail: ${u.email}\nTemporary password: ${password}\nPlease sign in and change your password.`,
    }).catch(() => {});
    return { tempPassword: password, email: u.email, loginUrl };
  }

  /** Toggle active, change role, reset password, or assign feature access (super admin). */
  async update(id: number, dto: { username?: string | null; isActive?: boolean; role?: UserRole; department?: Department | null; password?: string; featureGrants?: string[] | Record<string, string> | null; clientId?: number | null; branches?: string[]; companyCodes?: string[] }) {
    const u = await this.prisma.user.findUnique({ where: { id: BigInt(id) } });
    const codes = (a?: string[]) => [...new Set((a ?? []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
    if (!u) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: BigInt(id) },
      data: {
        isActive: dto.isActive,
        role: dto.role,
        ...(dto.department !== undefined ? { department: dto.department ?? null } : {}),
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
        ...(dto.featureGrants !== undefined ? { featureGrants: dto.featureGrants ?? Prisma.DbNull } : {}),
        // Customer link for a CLIENT_ADMIN portal login (null = internal staff). Lets ops fix a login
        // that shows "Client not found" by pointing it at the right customer.
        ...(dto.clientId !== undefined ? { clientId: dto.clientId != null ? BigInt(dto.clientId) : null } : {}),
        ...(dto.username !== undefined ? { username: String(dto.username ?? '').trim().toUpperCase() || null } : {}),
        // #10 — branch/company data scope; empty = unrestricted.
        ...(dto.branches !== undefined ? { branches: codes(dto.branches) } : {}),
        ...(dto.companyCodes !== undefined ? { companyCodes: codes(dto.companyCodes) } : {}),
      },
      select: { id: true, fullName: true, email: true, username: true, role: true, department: true, isActive: true, featureGrants: true, clientId: true, branches: true, companyCodes: true },
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('That username is already taken');
      throw e;
    });
  }

  /**
   * Attendance from the sign-in trail, per staff member per IST day: first sign-in, last sign-out
   * (or last sign-in when they never signed out), sign-in count. Customers are excluded.
   */
  async attendance(from: string, to: string) {
    const start = new Date(`${from}T00:00:00+05:30`), end = new Date(`${to}T23:59:59.999+05:30`);
    if (isNaN(+start) || isNaN(+end)) throw new BadRequestException('from / to must be YYYY-MM-DD');
    if (+end - +start > 92 * 864e5) throw new BadRequestException('Pick at most 3 months.');
    const [logs, users] = await Promise.all([
      this.prisma.loginLog.findMany({ where: { at: { gte: start, lte: end } }, orderBy: { at: 'asc' } }),
      this.prisma.user.findMany({ where: { role: { not: UserRole.CLIENT_ADMIN } }, select: { id: true, fullName: true, email: true, username: true, riderCode: true, role: true, department: true, isActive: true } }),
    ]);
    const staff = new Map(users.map((u) => [String(u.id), u]));
    const ist = (d: Date) => new Date(+d + 330 * 60000).toISOString().slice(0, 10);
    const days = new Map<string, { userId: string; date: string; firstIn: Date | null; lastOut: Date | null; lastIn: Date | null; logins: number }>();
    for (const l of logs) {
      const uid = String(l.userId);
      if (!staff.has(uid)) continue;
      const k = `${uid}|${ist(l.at)}`;
      const d = days.get(k) ?? { userId: uid, date: ist(l.at), firstIn: null, lastOut: null, lastIn: null, logins: 0 };
      if (l.kind === 'IN') { d.logins++; d.firstIn ??= l.at; d.lastIn = l.at; } else { d.lastOut = l.at; d.firstIn ??= l.at; }
      days.set(k, d);
    }
    const rows = [...days.values()].map((d) => {
      const u = staff.get(d.userId)!;
      const out = d.lastOut && (!d.lastIn || +d.lastOut >= +d.lastIn) ? d.lastOut : null;
      return {
        userId: d.userId, name: u.fullName, login: u.username ?? u.riderCode ?? u.email, role: u.role, department: u.department,
        date: d.date, firstIn: d.firstIn, lastOut: out, lastIn: d.lastIn, logins: d.logins,
        hours: out && d.firstIn ? +((+out - +d.firstIn) / 36e5).toFixed(2) : null,
      };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const summary = users.map((u) => {
      const mine = rows.filter((r) => r.userId === String(u.id));
      return {
        userId: String(u.id), name: u.fullName, login: u.username ?? u.riderCode ?? u.email, role: u.role, department: u.department, isActive: u.isActive,
        daysPresent: mine.length, totalHours: +mine.reduce((s, r) => s + (r.hours ?? 0), 0).toFixed(2), missingSignOut: mine.filter((r) => r.hours == null).length,
      };
    }).filter((s) => s.daysPresent > 0 || s.isActive).sort((a, b) => b.daysPresent - a.daysPresent || a.name.localeCompare(b.name));
    return { from, to, rows, summary };
  }
}
