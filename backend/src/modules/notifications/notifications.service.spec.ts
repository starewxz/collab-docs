import { NotificationType } from './notification-type.enum';
import { NotificationsService } from './notifications.service';

interface FakeInsertResult {
  identifiers: ({ id: string } | null)[];
  raw: unknown[];
  generatedMaps: unknown[];
}

interface FakeQueryBuilder {
  insert(): FakeQueryBuilder;
  into(): FakeQueryBuilder;
  values(v: Record<string, unknown>): FakeQueryBuilder;
  orIgnore(): FakeQueryBuilder;
  execute(): Promise<FakeInsertResult>;
}

function buildQueryBuilder(rows: Record<string, unknown>[]): FakeQueryBuilder {
  let pendingValues: Record<string, unknown> | undefined;
  const qb: FakeQueryBuilder = {
    insert: jest.fn((): FakeQueryBuilder => qb),
    into: jest.fn((): FakeQueryBuilder => qb),
    values: jest.fn((v: Record<string, unknown>): FakeQueryBuilder => {
      pendingValues = v;
      return qb;
    }),
    orIgnore: jest.fn((): FakeQueryBuilder => qb),
    execute: jest.fn((): Promise<FakeInsertResult> => {
      const exists = rows.some((r) => r.dedupeKey === pendingValues?.dedupeKey);
      if (exists) {
        // Real TypeORM/Postgres ON CONFLICT DO NOTHING still returns one
        // `identifiers` entry per input row, just `null` - an empty array
        // here would mask the exact bug this fixture caught (see
        // NotificationsService.createIfNotExists).
        return Promise.resolve({
          identifiers: [null],
          raw: [],
          generatedMaps: [],
        });
      }
      const row = { id: `n-${rows.length + 1}`, ...pendingValues };
      rows.push(row);
      return Promise.resolve({
        identifiers: [{ id: row.id }],
        raw: [],
        generatedMaps: [],
      });
    }),
  };
  return qb;
}

interface FakeSelectQueryBuilder {
  innerJoin(): FakeSelectQueryBuilder;
  select(): FakeSelectQueryBuilder;
  addSelect(): FakeSelectQueryBuilder;
  where(cond: string, params?: Record<string, unknown>): FakeSelectQueryBuilder;
  andWhere(cond: string): FakeSelectQueryBuilder;
  orderBy(): FakeSelectQueryBuilder;
  limit(): FakeSelectQueryBuilder;
  getRawMany<T>(): Promise<T[]>;
}

/** Mirrors the real list() query's shape (join + explicit field select,
 * never getRawAndEntities() - see ADR-019) closely enough to exercise
 * user-scoping/unreadOnly filtering and the workspaceId join without a
 * real database. */
function buildSelectQueryBuilder(
  rows: Record<string, unknown>[],
  documentWorkspaces: Record<string, string>,
): FakeSelectQueryBuilder {
  let userId: string | undefined;
  let unreadOnly = false;
  const qb: FakeSelectQueryBuilder = {
    innerJoin: () => qb,
    select: () => qb,
    addSelect: () => qb,
    where: (_cond, params) => {
      userId = params?.userId as string | undefined;
      return qb;
    },
    andWhere: () => {
      unreadOnly = true;
      return qb;
    },
    orderBy: () => qb,
    limit: () => qb,
    getRawMany: <T>() =>
      Promise.resolve(
        rows
          .filter((r) => r.userId === userId)
          .filter((r) => !unreadOnly || r.readAt == null)
          .sort(
            (a, b) =>
              (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          )
          .slice(0, 100)
          .map((r) => ({
            id: r.id,
            type: r.type,
            workspaceId: documentWorkspaces[r.documentId as string] ?? 'ws-1',
            documentId: r.documentId,
            commentId: r.commentId ?? null,
            actorId: r.actorId ?? null,
            readAt: r.readAt ?? null,
            createdAt: r.createdAt,
          })) as T[],
      ),
  };
  return qb;
}

function buildService() {
  const rows: Record<string, unknown>[] = [];
  const documentWorkspaces: Record<string, string> = { 'doc-1': 'ws-1' };
  const qb = buildQueryBuilder(rows);
  const selectQb = buildSelectQueryBuilder(rows, documentWorkspaces);

  const findByWhere = (
    where: Record<string, unknown>,
  ): Record<string, unknown>[] => {
    return rows.filter((r) =>
      Object.entries(where).every(([k, v]) => {
        if (
          v &&
          typeof v === 'object' &&
          'type' in v &&
          (v as { type: string }).type === 'isNull'
        ) {
          return r[k] == null;
        }
        return r[k] === v;
      }),
    );
  };

  const repo = {
    createQueryBuilder: jest.fn(
      (alias?: string): FakeQueryBuilder | FakeSelectQueryBuilder =>
        alias ? selectQb : qb,
    ),
    find: jest.fn(
      ({
        where,
      }: {
        where: Record<string, unknown>;
      }): Record<string, unknown>[] => findByWhere(where),
    ),
    count: jest.fn(
      ({ where }: { where: Record<string, unknown> }): number =>
        findByWhere(where).length,
    ),
    update: jest.fn(
      (where: Record<string, unknown>, partial: Record<string, unknown>) => {
        const matches = (r: Record<string, unknown>) =>
          Object.entries(where).every(([k, v]) => {
            if (
              v &&
              typeof v === 'object' &&
              'type' in v &&
              (v as { type: string }).type === 'isNull'
            ) {
              return r[k] == null;
            }
            return v == null ? r[k] == null : r[k] === v;
          });
        rows.filter(matches).forEach((r) => Object.assign(r, partial));
        return Promise.resolve({
          affected: rows.length,
          raw: [],
          generatedMaps: [],
        });
      },
    ),
  };

  const queue = { add: jest.fn(() => Promise.resolve()) };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const metrics = {
    notificationsProcessedTotal: { inc: jest.fn() },
  };

  const service = new NotificationsService(
    queue as never,
    repo as never,
    logger as never,
    metrics as never,
  );

  return { service, rows, queue, metrics };
}

function payload(
  overrides: Partial<
    Parameters<NotificationsService['createIfNotExists']>[0]
  > = {},
) {
  return {
    dedupeKey: 'mention_m1',
    userId: 'user-1',
    type: NotificationType.MENTION,
    documentId: 'doc-1',
    commentId: 'comment-1',
    actorId: 'user-2',
    ...overrides,
  };
}

describe('NotificationsService', () => {
  describe('enqueue', () => {
    it('adds a job with jobId set to the dedupeKey', async () => {
      const { service, queue } = buildService();
      await service.enqueue(payload());

      expect(queue.add).toHaveBeenCalledWith(
        'create-notification',
        expect.objectContaining({ dedupeKey: 'mention_m1' }),
        expect.objectContaining({ jobId: 'mention_m1' }),
      );
    });
  });

  describe('createIfNotExists (idempotency)', () => {
    it('creates a row on first call', async () => {
      const { service, rows, metrics } = buildService();
      await service.createIfNotExists(payload());

      expect(rows).toHaveLength(1);
      expect(metrics.notificationsProcessedTotal.inc).toHaveBeenCalledWith({
        result: 'created',
      });
    });

    it('does not create a duplicate row for a repeated dedupeKey (simulated redelivery)', async () => {
      const { service, rows, metrics } = buildService();
      await service.createIfNotExists(payload());
      await service.createIfNotExists(payload()); // same dedupeKey, e.g. a retried job

      expect(rows).toHaveLength(1);
      expect(metrics.notificationsProcessedTotal.inc).toHaveBeenLastCalledWith({
        result: 'duplicate',
      });
    });

    it('creates a separate row for a genuinely different event (different dedupeKey)', async () => {
      const { service, rows } = buildService();
      await service.createIfNotExists(
        payload({ dedupeKey: 'resolve_c1_100_u1' }),
      );
      await service.createIfNotExists(
        payload({ dedupeKey: 'resolve_c1_200_u1' }),
      );

      expect(rows).toHaveLength(2);
    });
  });

  describe('list', () => {
    it('returns only unread notifications when unreadOnly is true', async () => {
      const { service, rows } = buildService();
      rows.push(
        {
          id: 'n1',
          userId: 'user-1',
          documentId: 'doc-1',
          readAt: null,
          createdAt: new Date(),
        },
        {
          id: 'n2',
          userId: 'user-1',
          documentId: 'doc-1',
          readAt: new Date(),
          createdAt: new Date(),
        },
      );

      const result = await service.list('user-1', true);
      expect(result.map((r) => r.id)).toEqual(['n1']);
    });

    it('returns all notifications for the user when unreadOnly is false', async () => {
      const { service, rows } = buildService();
      rows.push(
        {
          id: 'n1',
          userId: 'user-1',
          documentId: 'doc-1',
          readAt: null,
          createdAt: new Date(),
        },
        {
          id: 'n2',
          userId: 'user-1',
          documentId: 'doc-1',
          readAt: new Date(),
          createdAt: new Date(),
        },
      );

      const result = await service.list('user-1', false);
      expect(result).toHaveLength(2);
    });

    it('never returns another user notifications', async () => {
      const { service, rows } = buildService();
      rows.push({
        id: 'n1',
        userId: 'other-user',
        documentId: 'doc-1',
        readAt: null,
        createdAt: new Date(),
      });

      const result = await service.list('user-1', false);
      expect(result).toHaveLength(0);
    });

    it("includes the workspaceId derived from the notification's document (Stage 9)", async () => {
      const { service, rows } = buildService();
      rows.push({
        id: 'n1',
        userId: 'user-1',
        documentId: 'doc-1',
        readAt: null,
        createdAt: new Date(),
      });

      const result = await service.list('user-1', false);
      expect(result[0].workspaceId).toBe('ws-1');
    });
  });

  describe('unreadCount', () => {
    it('counts only unread notifications for the given user', async () => {
      const { service, rows } = buildService();
      rows.push(
        { id: 'n1', userId: 'user-1', readAt: null },
        { id: 'n2', userId: 'user-1', readAt: null },
        { id: 'n3', userId: 'user-1', readAt: new Date() },
        { id: 'n4', userId: 'other-user', readAt: null },
      );

      expect(await service.unreadCount('user-1')).toBe(2);
    });
  });

  describe('markRead / markAllRead (IDOR-safe)', () => {
    it('markRead only affects the given user own notification', async () => {
      const { service, rows } = buildService();
      rows.push({ id: 'n1', userId: 'user-1', readAt: null });

      await service.markRead('user-1', 'n1');
      expect(rows[0].readAt).not.toBeNull();
    });

    it('markRead scoped to userId does not affect another user notification with the same id coincidence', async () => {
      const { service, rows } = buildService();
      rows.push({ id: 'n1', userId: 'other-user', readAt: null });

      await service.markRead('user-1', 'n1'); // wrong user - should not match
      expect(rows[0].readAt).toBeNull();
    });

    it('markAllRead marks every unread notification for the user only', async () => {
      const { service, rows } = buildService();
      rows.push(
        { id: 'n1', userId: 'user-1', readAt: null },
        { id: 'n2', userId: 'user-1', readAt: null },
        { id: 'n3', userId: 'other-user', readAt: null },
      );

      await service.markAllRead('user-1');
      expect(rows[0].readAt).not.toBeNull();
      expect(rows[1].readAt).not.toBeNull();
      expect(rows[2].readAt).toBeNull();
    });
  });
});
