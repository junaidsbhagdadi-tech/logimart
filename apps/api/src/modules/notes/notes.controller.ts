import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/notes.dto';

@Controller('api/v1/notes')
@UseGuards(RolesGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  create(@Body() dto: CreateNoteDto, @Req() req: any) {
    return this.notes.create({ ...dto, createdById: req.user?.sub ? Number(req.user.sub) : undefined });
  }

  /** Raise a Demurrage / reattempt debit note for an AWB (days × ₹/kg × chargeable kg, min), + GST. */
  @Post('demurrage')
  @Roles(UserRole.FINANCE_EXEC, UserRole.HUB_MANAGER, UserRole.SYS_ADMIN)
  demurrage(@Body() dto: { awb: string; firstAttemptDate?: string; days: number; ratePerKg: number; min?: number }, @Req() req: any) {
    return this.notes.demurrage({ ...dto, createdById: req.user?.sub ? Number(req.user.sub) : undefined });
  }

  @Get()
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  list(@Query('clientId') clientId?: string, @Query('kind') kind?: string) {
    return this.notes.list({ clientId: clientId ? Number(clientId) : undefined, kind });
  }

  @Get(':id')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  get(@Param('id') id: string) {
    return this.notes.get(Number(id));
  }

  @Post(':id/cancel')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  cancel(@Param('id') id: string) {
    return this.notes.cancel(Number(id));
  }
}
