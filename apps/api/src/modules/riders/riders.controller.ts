import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { RidersService } from './riders.service';

class CreateRiderDto {
  @IsString() @MinLength(2) fullName!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() vehicleNo?: string;
  @IsOptional() @IsInt() hubId?: number;
  @IsOptional() @IsString() @MinLength(4) pin?: string; // blank → auto 4-digit
}
class UpdateRiderDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() vehicleNo?: string;
  @IsOptional() @IsInt() hubId?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ResetPinDto {
  @IsOptional() @IsString() @MinLength(4) pin?: string;
}

@Controller('api/v1/riders')
@UseGuards(RolesGuard)
@Roles(UserRole.SYS_ADMIN, UserRole.HUB_MANAGER)
export class RidersController {
  constructor(private readonly riders: RidersService) {}

  @Get()
  list() {
    return this.riders.list();
  }

  @Post()
  create(@Body() dto: CreateRiderDto) {
    return this.riders.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRiderDto) {
    return this.riders.update(Number(id), dto);
  }

  @Post(':id/reset-pin')
  resetPin(@Param('id') id: string, @Body() dto: ResetPinDto) {
    return this.riders.resetPin(Number(id), dto.pin);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.riders.remove(Number(id));
  }
}
