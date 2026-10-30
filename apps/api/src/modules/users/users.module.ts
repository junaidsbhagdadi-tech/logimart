import { Module } from '@nestjs/common';
import { AttendanceController, UsersController } from './users.controller';
import { UsersService } from './users.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [UsersController, AttendanceController],
  providers: [UsersService],
})
export class UsersModule {}
