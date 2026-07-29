import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { ManifestsService } from './manifests.service';

class CreateManifestDto {
  @IsString() vehicleNo!: string;
  @IsInt() fromHubId!: number;
  @IsInt() toHubId!: number;
  @IsOptional() @IsInt() driverId?: number;
}
class AttachDto {
  @IsArray() awbs!: string[];
}

@Controller('api/v1/manifests')
@UseGuards(RolesGuard)
export class ManifestsController {
  constructor(private readonly manifests: ManifestsService) {}

  @Post()
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  create(@Body() dto: CreateManifestDto) {
    return this.manifests.create(dto);
  }

  @Get()
  @Roles(UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  list() {
    return this.manifests.list();
  }

  @Get(':id')
  @Roles(UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  get(@Param('id') id: string) {
    return this.manifests.get(Number(id));
  }

  @Post(':id/attach')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  attach(@Param('id') id: string, @Body() dto: AttachDto) {
    return this.manifests.attach(Number(id), dto.awbs);
  }

  @Post(':id/seal')
  @Roles(UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  seal(@Param('id') id: string) {
    return this.manifests.seal(Number(id));
  }

  @Post(':id/arrive')
  @Roles(UserRole.HUB_MANAGER, UserRole.DRIVER, UserRole.SYS_ADMIN)
  arrive(@Param('id') id: string) {
    return this.manifests.arrive(Number(id));
  }
}
