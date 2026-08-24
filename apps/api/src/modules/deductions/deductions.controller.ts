import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { DeductionsService } from './deductions.service';

class DeductionDto {
  @IsString() @MinLength(1) awb!: string;
  @IsString() @MinLength(1) vendorName!: string;
  @IsOptional() @IsString() vendorAcCode?: string;
  @IsOptional() @IsString() pickupDate?: string;
  @IsOptional() @IsString() deliveryDate?: string;
  @IsOptional() @IsString() emailCommDate?: string;
  @IsOptional() @IsString() madeToNames?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() attachment?: string;
  @IsOptional() @IsString() customerCode?: string;
}

@Controller('api/v1/deductions')
@UseGuards(RolesGuard)
@Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
export class DeductionsController {
  constructor(private readonly deductions: DeductionsService) {}

  @Get()
  list(@Query('month') month?: string) {
    return this.deductions.list(month);
  }

  @Post()
  create(@Body() dto: DeductionDto, @Req() req: any) {
    return this.deductions.create(dto, req.user?.sub ? Number(req.user.sub) : undefined);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.deductions.remove(Number(id));
  }
}
