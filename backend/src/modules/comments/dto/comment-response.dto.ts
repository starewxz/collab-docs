import { ApiProperty } from '@nestjs/swagger';
import type { Comment } from '../entities/comment.entity';

export class CommentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  documentId: string;

  @ApiProperty({ nullable: true })
  parentCommentId: string | null;

  @ApiProperty()
  authorId: string;

  @ApiProperty({ nullable: true })
  authorName: string | null;

  @ApiProperty()
  content: string;

  @ApiProperty({ nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ nullable: true })
  resolvedById: string | null;

  @ApiProperty({ nullable: true })
  editedAt: Date | null;

  @ApiProperty({ type: [String] })
  mentionedUserIds: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(
    comment: Comment,
    authorName: string | null,
    mentionedUserIds: string[],
  ): CommentResponseDto {
    const dto = new CommentResponseDto();
    dto.id = comment.id;
    dto.documentId = comment.documentId;
    dto.parentCommentId = comment.parentCommentId;
    dto.authorId = comment.authorId;
    dto.authorName = authorName;
    dto.content = comment.content;
    dto.resolvedAt = comment.resolvedAt;
    dto.resolvedById = comment.resolvedById;
    dto.editedAt = comment.editedAt;
    dto.mentionedUserIds = mentionedUserIds;
    dto.createdAt = comment.createdAt;
    dto.updatedAt = comment.updatedAt;
    return dto;
  }
}

export class CommentThreadResponseDto extends CommentResponseDto {
  @ApiProperty({ type: [CommentResponseDto] })
  replies: CommentResponseDto[];
}
