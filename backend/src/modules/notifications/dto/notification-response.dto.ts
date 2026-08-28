import { ApiProperty } from '@nestjs/swagger';
import type { NotificationType } from '../notification-type.enum';
import type { NotificationWithWorkspace } from '../notifications.service';

export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: ['mention', 'reply', 'thread_resolved', 'thread_reopened'],
  })
  type: NotificationType;

  /** Stage 9: alongside `documentId`, so the frontend can deep-link
   * straight to `/workspace/:workspaceId/document/:documentId` instead of
   * only telling the user something happened. Derived via a join against
   * `documents` at read time (not a stored column - a notification's
   * document never moves workspaces). */
  @ApiProperty()
  workspaceId: string;

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

  static fromEntity(
    notification: NotificationWithWorkspace,
  ): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = notification.id;
    dto.type = notification.type;
    dto.workspaceId = notification.workspaceId;
    dto.documentId = notification.documentId;
    dto.commentId = notification.commentId;
    dto.actorId = notification.actorId;
    dto.readAt = notification.readAt;
    dto.createdAt = notification.createdAt;
    return dto;
  }
}
