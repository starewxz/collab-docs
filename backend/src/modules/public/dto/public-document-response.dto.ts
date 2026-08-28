import { ApiProperty } from '@nestjs/swagger';
import type { PlainBlock } from '../../collaboration/yjs-document.util';

/**
 * Deliberately minimal: title, blocks, publishedAt, and the public access
 * mode only. No workspaceId, documentId, authorId/createdById, parentId,
 * archivedAt, comments, attachments, or version history - a public visitor
 * must never learn anything about the private workspace this document
 * lives in. `mode` tells the frontend whether to render the read-only
 * `PublicDocumentView` or the editable `PublicCollaborativeEditor` (TT gap
 * 2) - the slug itself (already known from the route) is what the client
 * then uses to open the anonymous `join-public` collaboration session.
 */
export class PublicDocumentResponseDto {
  @ApiProperty()
  title: string;

  @ApiProperty({ type: [Object] })
  blocks: PlainBlock[];

  @ApiProperty()
  publishedAt: Date;

  @ApiProperty({ enum: ['view', 'edit'] })
  mode: 'view' | 'edit';
}
