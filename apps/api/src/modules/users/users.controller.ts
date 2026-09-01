import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { Department, UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles, SuperAdminOnly } from '../../common/rbac/roles.decorator';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsString() @MinLength(2) fullName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() @MinLength(4) password?: string; // blank → auto-generated + emailed
  @IsEnum(UserRole) role!: UserRole;
  @IsOptional() @IsEnum(Department) department?: Department;
  @IsOptional() @IsInt() hubId?: number;
  @IsOptional() @IsInt() clientId?: number;
}
class UpdateUserDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  // null clears the department (unassigned); a value sets it. Skips @IsEnum so null passes through.
  @IsOptional() department?: Department | null;
  @IsOptional() @IsString() @MinLength(4) password?: string;
  // Either a legacy string[] (each feature = full access) or a { featureKey: 'VIEW'|'EDIT'|'DELETE' }
  // map. SYS_ADMIN-only endpoint, so accepted as-is (validated in the UI editor).
  @IsOptional() featureGrants?: string[] | Record<string, string> | null;
}

@Controller('api/v1/users')
@UseGuards(RolesGuard)
@Roles(UserRole.SYS_ADMIN)
@SuperAdminOnly()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(Number(id), dto);
  }

  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string) {
    return this.users.resetPassword(Number(id));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.users.remove(Number(id), req.user?.sub ? Number(req.user.sub) : undefined);
  }
}
