import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateRider {
  fullName: string;
  phone?: string;
  vehicleNo?: string;
  hubId?: number;
  pin?: string; // blank → auto-generated 4-digit
}

const riderView = {
  id: true, fullName: true, riderCode: true, phone: true, vehicleNo: true,
  hubId: true, isActive: true, createdAt: true,
} as const;

@Injectable()
export class RidersService {
  constructor(private readonly prisma: PrismaService) {}

  private gen4() {
    return String(randomInt(1000, 10000)); // 4-digit PIN
  }

  /** Next rider code RID001, RID002, … */
  private async nextRiderCode(): Promise<string> {
    const n = await this.prisma.user.count({ where: { role: UserRole.DRIVER } });
    // Skip any collisions (deleted/renumbered riders) by probing upward.
    for (let i = n + 1; i < n + 1000; i++) {
      const code = `RID${String(i).padStart(3, '0')}`;
      const exists = await this.prisma.user.findUnique({ where: { riderCode: code }, select: { id: true } });
      if (!exists) return code;
    }
    return `RID${Date.now()}`;
  }

  list() {
    return this.prisma.user.findMany({
      where: { role: UserRole.DRIVER },
      orderBy: { riderCode: 'asc' },
      select: riderView,
    });
  }

  async create(dto: CreateRider) {
    const riderCode = await this.nextRiderCode();
    const autoPin = !(dto.pin && dto.pin.trim());
    const pin = autoPin ? this.gen4() : dto.pin!.trim();
    // Riders sign in with Rider ID + PIN, so email/password aren't used — synthesize a unique,
    // non-login email and a random password hash to satisfy the shared User table.
    const email = `${riderCode.toLowerCase()}@rider.logimart.local`;
    const rider = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        email,
        passwordHash: await bcrypt.hash(`x${Date.now()}${riderCode}`, 10),
        role: UserRole.DRIVER,
        riderCode,
        pinHash: await bcrypt.hash(pin, 10),
        phone: dto.phone || null,
        vehicleNo: dto.vehicleNo || null,
        hubId: dto.hubId != null ? BigInt(dto.hubId) : null,
      },
      select: riderView,
    });
    return { ...rider, pin }; // PIN returned once so the admin can hand it over
  }

  async update(id: number, dto: { fullName?: string; phone?: string; vehicleNo?: string; hubId?: number | null; isActive?: boolean }) {
    await this.get(id);
    return this.prisma.user.update({
      where: { id: BigInt(id) },
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        vehicleNo: dto.vehicleNo,
        isActive: dto.isActive,
        ...(dto.hubId !== undefined ? { hubId: dto.hubId == null ? null : BigInt(dto.hubId) } : {}),
      },
      select: riderView,
    });
  }

  /** Issue a fresh PIN (auto or provided) — returned once so it can be relayed. */
  async resetPin(id: number, pin?: string) {
    await this.get(id);
    const newPin = pin && pin.trim() ? pin.trim() : this.gen4();
    await this.prisma.user.update({ where: { id: BigInt(id) }, data: { pinHash: await bcrypt.hash(newPin, 10) } });
    return { id: String(id), pin: newPin };
  }

  async remove(id: number) {
    const r = await this.get(id);
    // Preserve the audit trail: a rider who has scanned/delivered can't be hard-deleted.
    const [scans, pods] = await Promise.all([
      this.prisma.scanEvent.count({ where: { scannedById: BigInt(id) } }),
      this.prisma.pod.count({ where: { deliveredById: BigInt(id) } }),
    ]);
    if (scans > 0 || pods > 0) {
      throw new ConflictException(`${r.fullName} has recorded activity (${scans} scan(s), ${pods} POD(s)) — deactivate instead of deleting.`);
    }
    await this.prisma.user.delete({ where: { id: BigInt(id) } });
    return { ok: true, id };
  }

  private async get(id: number) {
    const r = await this.prisma.user.findFirst({ where: { id: BigInt(id), role: UserRole.DRIVER }, select: riderView });
    if (!r) throw new NotFoundException('Rider not found');
    return r;
  }
}
