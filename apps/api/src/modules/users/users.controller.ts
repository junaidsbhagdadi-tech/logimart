import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsString() @MinLength(2) fullName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() @MinLength(4) password?: string; // blank → auto-generated + emailed
  @IsEnum(UserRole) role!: UserRole;
  @IsOptional() @IsInt() hubId?: number;
  @IsOptional() @IsInt() clientId?: number;
}
class UpdateUserDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsString() @MinLength(4) password?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) featureGrants?: string[] | null;
}

@Controller('api/v1/users')
@UseGuards(RolesGuard)
@Roles(UserRole.SYS_ADMIN)
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

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.users.remove(Number(id), req.user?.sub ? Number(req.user.sub) : undefined);
  }
}
