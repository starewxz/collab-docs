import { ApiProperty } from '@nestjs/swagger';
import type { PlainBlock } from '../../collaboration/yjs-document.util';

/**
 * Deliberately minimal: title, blocks, publishedAt only. No workspaceId,
 * documentId, authorId/createdById, parentId, archivedAt, comments,
 * attachments, or version history - a public visitor must never learn
 * anything about the private workspace this document lives in.
 */
export class PublicDocumentResponseDto {
  @ApiProperty()
  title: string;

  @ApiProperty({ type: [Object] })
  blocks: PlainBlock[];

  @ApiProperty()
  publishedAt: Date;
}
