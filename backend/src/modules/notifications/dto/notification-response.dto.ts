import { ApiProperty } from '@nestjs/swagger';
import type { Notification } from '../entities/notification.entity';
import type { NotificationType } from '../notification-type.enum';

export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: ['mention', 'reply', 'thread_resolved', 'thread_reopened'],
  })
  type: NotificationType;

  @ApiProperty()
  documentId: string;

  @ApiProperty({ nullable: true })
  commentId: string | null;

  @ApiProperty({ nullable: true })
  actorId: string | null;

  @ApiProperty({ nullable: true })
  readAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(notification: Notification): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = notification.id;
    dto.type = notification.type;
    dto.documentId = notification.documentId;
    dto.commentId = notification.commentId;
    dto.actorId = notification.actorId;
    dto.readAt = notification.readAt;
    dto.createdAt = notification.createdAt;
    return dto;
  }
}
