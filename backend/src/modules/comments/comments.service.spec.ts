import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { WorkspaceRole } from '../workspaces/workspace-role.enum';

function isOperator(value: unknown): value is { type: string; value: unknown } {
  return !!value && typeof value === 'object' && 'type' in value;
}

class FakeRepo<T extends Record<string, unknown>> {
  rows: T[] = [];
  private seq = 0;

  private matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const val = row[key];
      if (isOperator(cond)) {
        if (cond.type === 'isNull') return val == null;
        if (cond.type === 'in') return (cond.value as unknown[]).includes(val);
      }
      return val === cond;
    });
  }

  find = jest.fn(({ where = {} }: { where?: Record<string, unknown> } = {}) =>
    Promise.resolve(this.rows.filter((r) => this.matches(r, where))),
  );

  findOne = jest.fn(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(this.rows.find((r) => this.matches(r, where)) ?? null),
  );

  create = jest.fn(
    (data: Partial<T>) =>
      ({
        id: data.id ?? `row-${++this.seq}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }) as T,
  );

  save = jest.fn((entity: T) => {
    const idx = this.rows.findIndex((r) => r.id === entity.id);
    if (idx === -1) this.rows.push(entity);
    else this.rows[idx] = entity;
    return Promise.resolve(entity);
  });

  remove = jest.fn((entities: T | T[]) => {
    const list = Array.isArray(entities) ? entities : [entities];
    for (const e of list) {
      const idx = this.rows.findIndex((r) => r.id === e.id);
      if (idx !== -1) this.rows.splice(idx, 1);
    }
    return Promise.resolve(entities);
  });
}

function buildService() {
  const comments = new FakeRepo<Record<string, unknown>>();
  const mentions = new FakeRepo<Record<string, unknown>>();
  const members = new FakeRepo<Record<string, unknown>>();

  const manager = {
    getRepository: jest.fn((entity: { name: string }) => {
      if (entity.name === 'Comment') return comments;
      if (entity.name === 'CommentMention') return mentions;
      if (entity.name === 'WorkspaceMember') return members;
      throw new Error(`Unexpected entity in test: ${entity.name}`);
    }),
  };
  const dataSource = {
    transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(manager)),
  };

  const documentsService = {
    get: jest.fn((_workspaceId: string, documentId: string) => ({
      id: documentId,
      archivedAt: null,
    })),
  };
  const usersService = {
    findById: jest.fn((id: string) => ({
      id,
      firstName: 'First',
      lastName: id,
    })),
  };
  const notificationsService = { enqueue: jest.fn(() => Promise.resolve()) };
  const permissions = {
    canModerateComments: jest.fn(
      (role: WorkspaceRole) =>
        role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN,
    ),
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const metrics = {
    commentsCreatedTotal: { inc: jest.fn() },
    commentThreadsResolvedTotal: { inc: jest.fn() },
  };

  const service = new CommentsService(
    dataSource as never,
    comments as never,
    mentions as never,
    documentsService as never,
    usersService as never,
    notificationsService as never,
    permissions as never,
    logger as never,
    metrics as never,
  );

  return {
    service,
    comments,
    mentions,
    members,
    documentsService,
    notificationsService,
    permissions,
  };
}

describe('CommentsService', () => {
  describe('create', () => {
    it('creates a root comment', async () => {
      const { service } = buildService();
      const result = await service.create('ws-1', 'doc-1', 'user-1', {
        content: 'hello',
      });

      expect(result.parentCommentId).toBeNull();
      expect(result.content).toBe('hello');
    });

    it('rejects commenting on an archived document', async () => {
      const { service, documentsService } = buildService();
      documentsService.get.mockReturnValueOnce({
        id: 'doc-1',
        archivedAt: new Date(),
      });

      await expect(
        service.create('ws-1', 'doc-1', 'user-1', { content: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects replying to a reply (max one level of nesting)', async () => {
      const { service, comments } = buildService();
      comments.rows.push(
        {
          id: 'root',
          documentId: 'doc-1',
          parentCommentId: null,
          authorId: 'u1',
          deletedAt: null,
        },
        {
          id: 'reply',
          documentId: 'doc-1',
          parentCommentId: 'root',
          authorId: 'u1',
          deletedAt: null,
        },
      );

      await expect(
        service.create('ws-1', 'doc-1', 'user-1', {
          content: 'x',
          parentCommentId: 'reply',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects replying to a deleted comment', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'root',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'u1',
        deletedAt: new Date(),
      });

      await expect(
        service.create('ws-1', 'doc-1', 'user-1', {
          content: 'x',
          parentCommentId: 'root',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects mentioning a user who is not a workspace member', async () => {
      const { service, members } = buildService();
      members.rows.push({ workspaceId: 'ws-1', userId: 'member-1' });

      await expect(
        service.create('ws-1', 'doc-1', 'user-1', {
          content: 'hi @outsider',
          mentionedUserIds: ['outsider-1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('de-dupes repeated mentions of the same user into a single mention row', async () => {
      const { service, members, mentions } = buildService();
      members.rows.push({ workspaceId: 'ws-1', userId: 'member-1' });

      const result = await service.create('ws-1', 'doc-1', 'user-1', {
        content: 'hi',
        mentionedUserIds: ['member-1', 'member-1'],
      });

      expect(result.mentionedUserIds).toEqual(['member-1']);
      expect(mentions.rows).toHaveLength(1);
    });

    it('enqueues exactly one mention notification for a valid mention', async () => {
      const { service, members, notificationsService } = buildService();
      members.rows.push({ workspaceId: 'ws-1', userId: 'member-1' });

      await service.create('ws-1', 'doc-1', 'user-1', {
        content: 'hi',
        mentionedUserIds: ['member-1'],
      });

      expect(notificationsService.enqueue).toHaveBeenCalledTimes(1);
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mention', userId: 'member-1' }),
      );
    });

    it('does not notify a user for mentioning themselves', async () => {
      const { service, members, notificationsService } = buildService();
      members.rows.push({ workspaceId: 'ws-1', userId: 'user-1' });

      await service.create('ws-1', 'doc-1', 'user-1', {
        content: 'note to self',
        mentionedUserIds: ['user-1'],
      });

      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues a reply notification to the root author, but not when replying to your own thread', async () => {
      const { service, comments, notificationsService } = buildService();
      comments.rows.push({
        id: 'root',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'root-author',
        deletedAt: null,
      });

      await service.create('ws-1', 'doc-1', 'replier', {
        content: 'reply',
        parentCommentId: 'root',
      });
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'reply', userId: 'root-author' }),
      );

      notificationsService.enqueue.mockClear();
      await service.create('ws-1', 'doc-1', 'root-author', {
        content: 'self reply',
        parentCommentId: 'root',
      });
      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('allows the author to edit their own comment', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'c1',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'user-1',
        content: 'old',
        deletedAt: null,
      });

      const result = await service.update('ws-1', 'doc-1', 'c1', 'user-1', {
        content: 'new',
      });
      expect(result.content).toBe('new');
    });

    it('rejects editing someone else comment, even for OWNER/ADMIN', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'c1',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'author-1',
        content: 'old',
        deletedAt: null,
      });

      await expect(
        service.update('ws-1', 'doc-1', 'c1', 'someone-else', {
          content: 'hacked',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('adds newly-added mentions and notifies only the new ones', async () => {
      const { service, comments, members, notificationsService } =
        buildService();
      members.rows.push(
        { workspaceId: 'ws-1', userId: 'member-1' },
        { workspaceId: 'ws-1', userId: 'member-2' },
      );
      comments.rows.push({
        id: 'c1',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'user-1',
        content: 'old',
        deletedAt: null,
      });

      await service.update('ws-1', 'doc-1', 'c1', 'user-1', {
        content: 'hi @member-1',
        mentionedUserIds: ['member-1'],
      });
      expect(notificationsService.enqueue).toHaveBeenCalledTimes(1);
      notificationsService.enqueue.mockClear();

      const result = await service.update('ws-1', 'doc-1', 'c1', 'user-1', {
        content: 'hi @member-1 and @member-2',
        mentionedUserIds: ['member-1', 'member-2'],
      });

      // only the newly-added mention (member-2) should trigger a fresh notification
      expect(notificationsService.enqueue).toHaveBeenCalledTimes(1);
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'member-2' }),
      );
      expect(result.mentionedUserIds.sort()).toEqual(['member-1', 'member-2']);
    });

    it('removes mentions no longer present in the edited content', async () => {
      const { service, comments, members, mentions } = buildService();
      members.rows.push({ workspaceId: 'ws-1', userId: 'member-1' });
      comments.rows.push({
        id: 'c1',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'user-1',
        content: 'old',
        deletedAt: null,
      });
      await service.update('ws-1', 'doc-1', 'c1', 'user-1', {
        content: 'hi @member-1',
        mentionedUserIds: ['member-1'],
      });

      const result = await service.update('ws-1', 'doc-1', 'c1', 'user-1', {
        content: 'no mentions anymore',
        mentionedUserIds: [],
      });

      expect(result.mentionedUserIds).toEqual([]);
      expect(mentions.rows).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('lets the author delete their own comment', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'c1',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'user-1',
        deletedAt: null,
      });

      await service.remove(
        'ws-1',
        'doc-1',
        'c1',
        'user-1',
        WorkspaceRole.EDITOR,
      );
      expect(comments.rows[0].deletedAt).not.toBeNull();
    });

    it('rejects an EDITOR deleting someone else comment', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'c1',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'author-1',
        deletedAt: null,
      });

      await expect(
        service.remove(
          'ws-1',
          'doc-1',
          'c1',
          'someone-else',
          WorkspaceRole.EDITOR,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets OWNER/ADMIN moderate (delete) someone else comment', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'c1',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'author-1',
        deletedAt: null,
      });

      await service.remove(
        'ws-1',
        'doc-1',
        'c1',
        'admin-user',
        WorkspaceRole.ADMIN,
      );
      expect(comments.rows[0].deletedAt).not.toBeNull();
    });

    it('throws 404 for a comment belonging to a different document (IDOR)', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'c1',
        documentId: 'other-doc',
        parentCommentId: null,
        authorId: 'user-1',
        deletedAt: null,
      });

      await expect(
        service.remove('ws-1', 'doc-1', 'c1', 'user-1', WorkspaceRole.OWNER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolve / reopen', () => {
    it('resolves a root comment and records who resolved it', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'root',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'author-1',
        deletedAt: null,
        resolvedAt: null,
      });

      const result = await service.resolve(
        'ws-1',
        'doc-1',
        'root',
        'resolver-1',
      );
      expect(result.resolvedAt).not.toBeNull();
      expect(result.resolvedById).toBe('resolver-1');
    });

    it('rejects resolving a reply (only root comments can be resolved)', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'reply',
        documentId: 'doc-1',
        parentCommentId: 'root',
        authorId: 'author-1',
        deletedAt: null,
        resolvedAt: null,
      });

      await expect(
        service.resolve('ws-1', 'doc-1', 'reply', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('reopen clears resolvedAt/resolvedById', async () => {
      const { service, comments } = buildService();
      comments.rows.push({
        id: 'root',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'author-1',
        deletedAt: null,
        resolvedAt: new Date(),
        resolvedById: 'resolver-1',
      });

      const result = await service.reopen('ws-1', 'doc-1', 'root', 'user-2');
      expect(result.resolvedAt).toBeNull();
      expect(result.resolvedById).toBeNull();
    });

    it('resolving an already-resolved thread is idempotent (no duplicate notification)', async () => {
      const { service, comments, notificationsService } = buildService();
      comments.rows.push({
        id: 'root',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'author-1',
        deletedAt: null,
        resolvedAt: null,
      });

      await service.resolve('ws-1', 'doc-1', 'root', 'resolver-1');
      expect(notificationsService.enqueue).toHaveBeenCalledTimes(1);
      notificationsService.enqueue.mockClear();

      await service.resolve('ws-1', 'doc-1', 'root', 'resolver-1'); // already resolved
      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('does not notify the author for resolving their own thread', async () => {
      const { service, comments, notificationsService } = buildService();
      comments.rows.push({
        id: 'root',
        documentId: 'doc-1',
        parentCommentId: null,
        authorId: 'author-1',
        deletedAt: null,
        resolvedAt: null,
      });

      await service.resolve('ws-1', 'doc-1', 'root', 'author-1');
      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('nests replies under their root and excludes deleted comments', async () => {
      const { service, comments } = buildService();
      comments.rows.push(
        {
          id: 'root',
          documentId: 'doc-1',
          parentCommentId: null,
          authorId: 'u1',
          content: 'root',
          deletedAt: null,
          createdAt: new Date(0),
        },
        {
          id: 'reply1',
          documentId: 'doc-1',
          parentCommentId: 'root',
          authorId: 'u2',
          content: 'r1',
          deletedAt: null,
          createdAt: new Date(1),
        },
        {
          id: 'deleted-root',
          documentId: 'doc-1',
          parentCommentId: null,
          authorId: 'u1',
          content: 'gone',
          deletedAt: new Date(),
          createdAt: new Date(2),
        },
      );

      const result = await service.list('ws-1', 'doc-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('root');
      expect(result[0].replies.map((r) => r.id)).toEqual(['reply1']);
    });
  });
});
