import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles, Feature } from '../../common/rbac/roles.decorator';
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
  @IsOptional() @IsNumber() approvedAmount?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() remark?: string;
}

@Controller('api/v1/deductions')
@UseGuards(RolesGuard)
@Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
export class DeductionsController {
  constructor(private readonly deductions: DeductionsService) {}

  // list / lookup / create carry @Feature('/claims') so the Customer Service desk (granted /claims)
  // can VIEW and POST deductions — additive to the class @Roles. approve/reject/update/delete stay
  // role-only (Finance + SuperAdmin), so CS can post but only Finance/SuperAdmin can approve.
  @Get()
  @Feature('/claims')
  list(@Query('month') month?: string) {
    return this.deductions.list(month);
  }

  @Get('awb/:awb')
  @Feature('/claims')
  awbLookup(@Param('awb') awb: string) {
    return this.deductions.awbLookup(awb);
  }

  @Post()
  @Feature('/claims')
  create(@Body() dto: DeductionDto, @Req() req: any) {
    return this.deductions.create(dto, req.user?.sub ? Number(req.user.sub) : undefined);
  }

  // ---- approval gate: Finance + SuperAdmin only (no @Feature, so CS can't approve) ----
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: { approvedAmount?: number; remark?: string }) {
    return this.deductions.approve(Number(id), dto?.approvedAmount, dto?.remark);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: { remark?: string }) {
    return this.deductions.reject(Number(id), dto?.remark);
  }

  @Post(':id')
  update(@Param('id') id: string, @Body() dto: DeductionDto) {
    return this.deductions.update(Number(id), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.deductions.remove(Number(id));
  }
}
