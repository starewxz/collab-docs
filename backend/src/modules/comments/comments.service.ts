import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { UsersService } from '../users/users.service';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';
import { WorkspaceRole } from '../workspaces/workspace-role.enum';
import {
  CommentThreadResponseDto,
  CommentResponseDto,
} from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentMention } from './entities/comment-mention.entity';
import { Comment } from './entities/comment.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(CommentMention)
    private readonly mentions: Repository<CommentMention>,
    private readonly documentsService: DocumentsService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly permissions: WorkspacePermissionsService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext(CommentsService.name);
  }

  /** Flat non-deleted comments grouped into root threads + their replies.
   * If a thread's root is deleted, the whole thread (including any
   * still-non-deleted replies) is hidden from the list - a deliberate
   * simplification over showing orphaned replies under a "[deleted]"
   * placeholder root. */
  async list(
    workspaceId: string,
    documentId: string,
  ): Promise<CommentThreadResponseDto[]> {
    await this.documentsService.get(workspaceId, documentId);

    const all = await this.comments.find({
      where: { documentId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (all.length === 0) return [];

    const mentionRows = await this.mentions.find({
      where: { commentId: In(all.map((c) => c.id)) },
    });
    const mentionsByComment = new Map<string, string[]>();
    for (const m of mentionRows) {
      const list = mentionsByComment.get(m.commentId) ?? [];
      list.push(m.mentionedUserId);
      mentionsByComment.set(m.commentId, list);
    }

    const authorNames = await this.resolveAuthorNames(
      all.map((c) => c.authorId),
    );

    const roots = all.filter((c) => !c.parentCommentId);
    const repliesByParent = new Map<string, Comment[]>();
    for (const c of all) {
      if (!c.parentCommentId) continue;
      const list = repliesByParent.get(c.parentCommentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentCommentId, list);
    }

    return roots.map((root) => {
      const dto = CommentResponseDto.fromEntity(
        root,
        authorNames.get(root.authorId) ?? null,
        mentionsByComment.get(root.id) ?? [],
      ) as CommentThreadResponseDto;
      dto.replies = (repliesByParent.get(root.id) ?? []).map((reply) =>
        CommentResponseDto.fromEntity(
          reply,
          authorNames.get(reply.authorId) ?? null,
          mentionsByComment.get(reply.id) ?? [],
        ),
      );
      return dto;
    });
  }

  async create(
    workspaceId: string,
    documentId: string,
    authorId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const document = await this.documentsService.get(workspaceId, documentId);
    if (document.archivedAt) {
      throw new BadRequestException('Cannot comment on an archived document');
    }

    let parentComment: Comment | null = null;
    if (dto.parentCommentId) {
      parentComment = await this.getScoped(documentId, dto.parentCommentId);
      if (parentComment.parentCommentId) {
        throw new BadRequestException(
          'Replies cannot be nested more than one level deep',
        );
      }
      if (parentComment.deletedAt) {
        throw new BadRequestException('Cannot reply to a deleted comment');
      }
    }

    const { comment, mentionRows } = await this.dataSource.transaction(
      async (manager) => {
        const commentsRepo = manager.getRepository(Comment);
        const comment = await commentsRepo.save(
          commentsRepo.create({
            documentId,
            parentCommentId: dto.parentCommentId ?? null,
            authorId,
            content: dto.content,
          }),
        );
        const mentionRows = await this.createMentions(
          manager,
          workspaceId,
          comment.id,
          dto.mentionedUserIds ?? [],
        );
        return { comment, mentionRows };
      },
    );

    this.metrics.commentsCreatedTotal.inc({
      kind: parentComment ? 'reply' : 'root',
    });
    this.logger.info(
      {
        event: 'comment_created',
        documentId,
        commentId: comment.id,
        kind: parentComment ? 'reply' : 'root',
      },
      'comment_created',
    );

    await this.notifyMentions(mentionRows, documentId, comment.id, authorId);
    if (parentComment && parentComment.authorId !== authorId) {
      await this.safeEnqueue({
        dedupeKey: `reply_${comment.id}_${parentComment.authorId}`,
        userId: parentComment.authorId,
        type: NotificationType.REPLY,
        documentId,
        commentId: comment.id,
        actorId: authorId,
      });
    }

    const authorNames = await this.resolveAuthorNames([authorId]);
    return CommentResponseDto.fromEntity(
      comment,
      authorNames.get(authorId) ?? null,
      mentionRows.map((m) => m.mentionedUserId),
    );
  }

  async update(
    workspaceId: string,
    documentId: string,
    commentId: string,
    authorId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    const document = await this.documentsService.get(workspaceId, documentId);
    if (document.archivedAt) {
      throw new BadRequestException(
        'Cannot edit a comment on an archived document',
      );
    }
    const comment = await this.getScoped(documentId, commentId);
    if (comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.authorId !== authorId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const newMentionRows = await this.dataSource.transaction(
      async (manager) => {
        const commentsRepo = manager.getRepository(Comment);
        const mentionsRepo = manager.getRepository(CommentMention);

        comment.content = dto.content;
        comment.editedAt = new Date();
        await commentsRepo.save(comment);

        const desiredIds = new Set(dto.mentionedUserIds ?? []);
        const existingMentions = await mentionsRepo.find({
          where: { commentId },
        });
        const existingIds = new Set(
          existingMentions.map((m) => m.mentionedUserId),
        );

        const toRemove = existingMentions.filter(
          (m) => !desiredIds.has(m.mentionedUserId),
        );
        if (toRemove.length > 0) {
          await mentionsRepo.remove(toRemove);
        }

        const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
        return this.createMentions(manager, workspaceId, commentId, toAdd);
      },
    );

    await this.notifyMentions(newMentionRows, documentId, commentId, authorId);

    const finalMentions = await this.mentions.find({ where: { commentId } });
    const authorNames = await this.resolveAuthorNames([authorId]);
    return CommentResponseDto.fromEntity(
      comment,
      authorNames.get(authorId) ?? null,
      finalMentions.map((m) => m.mentionedUserId),
    );
  }

  async remove(
    workspaceId: string,
    documentId: string,
    commentId: string,
    actorId: string,
    actorRole: WorkspaceRole,
  ): Promise<void> {
    await this.documentsService.get(workspaceId, documentId);
    const comment = await this.getScoped(documentId, commentId);
    if (comment.deletedAt) return; // idempotent

    const isOwnComment = comment.authorId === actorId;
    if (!isOwnComment && !this.permissions.canModerateComments(actorRole)) {
      throw new ForbiddenException('You cannot delete this comment');
    }

    comment.deletedAt = new Date();
    await this.comments.save(comment);
    this.logger.info(
      {
        event: 'comment_deleted',
        documentId,
        commentId,
        moderated: !isOwnComment,
      },
      'comment_deleted',
    );
  }

  async resolve(
    workspaceId: string,
    documentId: string,
    commentId: string,
    actorId: string,
  ): Promise<CommentResponseDto> {
    return this.setResolved(workspaceId, documentId, commentId, actorId, true);
  }

  async reopen(
    workspaceId: string,
    documentId: string,
    commentId: string,
    actorId: string,
  ): Promise<CommentResponseDto> {
    return this.setResolved(workspaceId, documentId, commentId, actorId, false);
  }

  private async setResolved(
    workspaceId: string,
    documentId: string,
    commentId: string,
    actorId: string,
    resolved: boolean,
  ): Promise<CommentResponseDto> {
    const document = await this.documentsService.get(workspaceId, documentId);
    if (document.archivedAt) {
      throw new BadRequestException(
        'Cannot resolve/reopen a thread on an archived document',
      );
    }
    const comment = await this.getScoped(documentId, commentId);
    if (comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.parentCommentId) {
      throw new BadRequestException(
        "Only a thread's root comment can be resolved/reopened",
      );
    }

    const alreadyInState = resolved
      ? !!comment.resolvedAt
      : !comment.resolvedAt;
    if (!alreadyInState) {
      const actionAt = new Date();
      comment.resolvedAt = resolved ? actionAt : null;
      comment.resolvedById = resolved ? actorId : null;
      await this.comments.save(comment);

      this.metrics.commentThreadsResolvedTotal.inc({
        action: resolved ? 'resolved' : 'reopened',
      });
      this.logger.info(
        {
          event: resolved ? 'thread_resolved' : 'thread_reopened',
          documentId,
          commentId,
        },
        resolved ? 'thread_resolved' : 'thread_reopened',
      );

      if (comment.authorId !== actorId) {
        await this.safeEnqueue({
          dedupeKey: `${resolved ? 'resolve' : 'reopen'}_${comment.id}_${actionAt.getTime()}_${comment.authorId}`,
          userId: comment.authorId,
          type: resolved
            ? NotificationType.THREAD_RESOLVED
            : NotificationType.THREAD_REOPENED,
          documentId,
          commentId: comment.id,
          actorId,
        });
      }
    }

    const finalMentions = await this.mentions.find({ where: { commentId } });
    const authorNames = await this.resolveAuthorNames([comment.authorId]);
    return CommentResponseDto.fromEntity(
      comment,
      authorNames.get(comment.authorId) ?? null,
      finalMentions.map((m) => m.mentionedUserId),
    );
  }

  // --- internal helpers ---

  /** Notification enqueueing is a secondary side-effect of an already-
   * committed comment - a failed enqueue must never surface as a failure
   * of the comment-creation/edit request itself (the comment is real
   * either way, and the client should not be led to believe otherwise
   * and retry, creating an unintended duplicate comment). Failures are
   * logged/metriced, not thrown. */
  private async notifyMentions(
    mentionRows: CommentMention[],
    documentId: string,
    commentId: string,
    actorId: string,
  ): Promise<void> {
    for (const mention of mentionRows) {
      if (mention.mentionedUserId === actorId) continue; // no self-notify
      await this.safeEnqueue({
        dedupeKey: `mention_${mention.id}`,
        userId: mention.mentionedUserId,
        type: NotificationType.MENTION,
        documentId,
        commentId,
        actorId,
      });
    }
  }

  private async safeEnqueue(
    payload: Parameters<NotificationsService['enqueue']>[0],
  ): Promise<void> {
    try {
      await this.notificationsService.enqueue(payload);
    } catch (err) {
      this.logger.warn(
        {
          event: 'notification_enqueue_failed',
          dedupeKey: payload.dedupeKey,
          error: (err as Error).message,
        },
        'notification_enqueue_failed',
      );
    }
  }

  /** Validates every id is a real workspace member (no cross-workspace
   * mentions) before inserting; de-dupes the input first so re-mentioning
   * the same user twice in one submission never even attempts a duplicate
   * insert (the DB unique index is the backstop for races, not the primary
   * mechanism here). */
  private async createMentions(
    manager: EntityManager,
    workspaceId: string,
    commentId: string,
    mentionedUserIds: string[],
  ): Promise<CommentMention[]> {
    const uniqueIds = [...new Set(mentionedUserIds)];
    if (uniqueIds.length === 0) return [];

    const membersRepo = manager.getRepository(WorkspaceMember);
    const validMembers = await membersRepo.find({
      where: { workspaceId, userId: In(uniqueIds) },
    });
    const validUserIds = new Set(validMembers.map((m) => m.userId));
    const invalidIds = uniqueIds.filter((id) => !validUserIds.has(id));
    if (invalidIds.length > 0) {
      throw new BadRequestException(
        'Cannot mention users who are not members of this workspace',
      );
    }

    const mentionsRepo = manager.getRepository(CommentMention);
    const rows: CommentMention[] = [];
    for (const userId of uniqueIds) {
      rows.push(
        await mentionsRepo.save(
          mentionsRepo.create({ commentId, mentionedUserId: userId }),
        ),
      );
    }
    return rows;
  }

  /** Scoped by (id, documentId) together - the same IDOR-safe pattern used
   * by every other document-scoped lookup in this project. */
  private async getScoped(
    documentId: string,
    commentId: string,
  ): Promise<Comment> {
    const comment = await this.comments.findOne({
      where: { id: commentId, documentId },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  private async resolveAuthorNames(
    userIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    const names = new Map<string, string>();
    for (const id of ids) {
      const user = await this.usersService.findById(id);
      if (user) names.set(id, `${user.firstName} ${user.lastName}`.trim());
    }
    return names;
  }
}
