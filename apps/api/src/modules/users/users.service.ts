import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateUser {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  hubId?: number;
  clientId?: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, fullName: true, email: true, role: true, hubId: true, clientId: true, isActive: true, featureGrants: true },
    });
  }

  async create(dto: CreateUser) {
    try {
      const u = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: dto.role,
          hubId: dto.hubId != null ? BigInt(dto.hubId) : null,
          clientId: dto.clientId != null ? BigInt(dto.clientId) : null,
        },
        select: { id: true, fullName: true, email: true, role: true, isActive: true },
      });
      return u;
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
