import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

class CreateFeedbackDto {
  @IsString() @MinLength(3) message!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() category?: string; // change | add | remove | bug | other
}

@Controller('api/v1/feedback')
@UseGuards(RolesGuard)
export class FeedbackController {
  constructor(private readonly prisma: PrismaService) {}

  /** Any logged-in tester can submit feedback. */
  @Post()
  create(@Body() dto: CreateFeedbackDto, @Req() req: any) {
    return this.prisma.feedback.create({
      data: {
        message: dto.message,
        rating: dto.rating,
        page: dto.page,
        category: dto.category,
        userName: req.user.email,
        role: req.user.role,
      },
    });
  }

  /** Admin inbox. */
  @Get()
  @Roles(UserRole.SYS_ADMIN)
  list() {
    return this.prisma.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Patch(':id')
  @Roles(UserRole.SYS_ADMIN)
  markReviewed(@Param('id') id: string) {
    return this.prisma.feedback.update({ where: { id: BigInt(id) }, data: { status: 'reviewed' } });
  }
}
