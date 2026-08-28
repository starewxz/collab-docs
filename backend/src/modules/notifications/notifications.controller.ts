import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

/** User-scoped, not workspace-scoped - a notification belongs to the
 * recipient regardless of which workspace/document triggered it, so this
 * controller only needs JwtAuthGuard, not WorkspaceMembershipGuard. */
@ApiBearerAuth()
@ApiTags('notifications')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('unreadOnly') unreadOnly?: string,
  ): Promise<NotificationResponseDto[]> {
    const notifications = await this.notificationsService.list(
      user.sub,
      unreadOnly === 'true',
    );
    return notifications.map((n) => NotificationResponseDto.fromEntity(n));
  }

  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ count: number }> {
    const count = await this.notificationsService.unreadCount(user.sub);
    return { count };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/read')
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notificationsService.markRead(user.sub, id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('read-all')
  async markAllRead(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.notificationsService.markAllRead(user.sub);
  }
}
