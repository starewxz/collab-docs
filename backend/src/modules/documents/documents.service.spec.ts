import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import { DocumentsService } from './documents.service';
import { Document } from './entities/document.entity';

interface FindOperatorLike {
  type: string;
  value: unknown;
}

function isOperator(value: unknown): value is FindOperatorLike {
  return !!value && typeof value === 'object' && 'type' in value;
}

/** Minimal in-memory stand-in for TypeORM's Repository<Document>, just
 * enough to exercise the tree/ordering logic under real query shapes
 * (IsNull(), In()) instead of hand-stubbing each call's return value. */
class FakeDocumentRepo {
  rows: Document[] = [];
  private seq = 0;

  private matches(row: Document, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const val = (row as unknown as Record<string, unknown>)[key];
      if (isOperator(cond)) {
        if (cond.type === 'isNull') return val === null;
        if (cond.type === 'in')
          return (cond.value as string[]).includes(val as string);
      }
      return val === cond;
    });
  }

  find = jest.fn(
    ({
      where = {},
      order,
    }: {
      where?: Record<string, unknown>;
      order?: Record<string, 'ASC' | 'DESC'>;
    } = {}) => {
      let result = this.rows.filter((r) => this.matches(r, where));
      if (order) {
        const [key, dir] = Object.entries(order)[0];
        result = [...result].sort((a, b) => {
          const av = (a as unknown as Record<string, number>)[key];
          const bv = (b as unknown as Record<string, number>)[key];
          return dir === 'ASC' ? av - bv : bv - av;
        });
      }
      return result;
    },
  );

  findOne = jest.fn(
    ({
      where,
      order,
    }: {
      where: Record<string, unknown>;
      order?: Record<string, 'ASC' | 'DESC'>;
    }) => {
      let result = this.rows.filter((r) => this.matches(r, where));
      if (order) {
        const [key, dir] = Object.entries(order)[0];
        result = [...result].sort((a, b) => {
          const av = (a as unknown as Record<string, number>)[key];
          const bv = (b as unknown as Record<string, number>)[key];
          return dir === 'ASC' ? av - bv : bv - av;
        });
      }
      return result[0] ?? null;
    },
  );

  create = jest.fn(
    (data: Partial<Document>) =>
      ({
        id: data.id ?? `doc-${++this.seq}`,
        archivedAt: null,
        isPublished: false,
        publicSlug: null,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }) as Document,
  );

  save = jest.fn((entity: Document) => {
    if (entity.publicSlug !== null) {
      const collision = this.rows.some(
        (r) => r.id !== entity.id && r.publicSlug === entity.publicSlug,
      );
      if (collision) {
        throw Object.assign(new Error('duplicate key value'), {
          code: '23505',
        });
      }
    }
    const idx = this.rows.findIndex((r) => r.id === entity.id);
    if (idx === -1) this.rows.push(entity);
    else this.rows[idx] = entity;
    return entity;
  });

  update = jest.fn(
    (where: Record<string, unknown>, partial: Partial<Document>) => {
      this.rows
        .filter((r) => this.matches(r, where))
        .forEach((r) => Object.assign(r, partial));
      return { affected: this.rows.length, raw: [], generatedMaps: [] };
    },
  );
}

function buildService(seed: Document[] = []) {
  const repo = new FakeDocumentRepo();
  repo.rows = seed;

  const dataSource = {
    transaction: jest.fn((cb: (manager: unknown) => unknown) =>
      cb({ getRepository: () => repo }),
    ),
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const metrics = {
    documentsCreatedTotal: { inc: jest.fn() },
    documentsArchivedTotal: { inc: jest.fn() },
    documentOperationsTotal: { inc: jest.fn() },
    documentsPublishedTotal: { inc: jest.fn() },
    documentsUnpublishedTotal: { inc: jest.fn() },
    documentTreeCacheTotal: { inc: jest.fn() },
  };
  const revalidation = { revalidateSlug: jest.fn() };
  const entitlements = {
    lockWorkspace: jest.fn(),
    assertCanCreateDocument: jest.fn(),
  };
  // Always-miss stand-in - list()'s caching behavior has its own focused
  // tests below; the other describe blocks just need get/find to keep
  // working exactly as before.
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    del: jest.fn(),
  };

  const service = new DocumentsService(
    dataSource as never,
    repo as never,
    logger as never,
    metrics as never,
    revalidation as never,
    entitlements as never,
    redis as never,
  );

  return { service, repo, metrics, revalidation, entitlements, redis };
}

function doc(overrides: Partial<Document>): Document {
  return {
    id: 'doc',
    workspaceId: 'ws-1',
    parentId: null,
    title: 'Untitled',
    position: 1000,
    createdById: 'user-1',
    archivedAt: null,
    isPublished: false,
    publicSlug: null,
    publishedAt: null,
    publicAccessMode: 'view',
    publicExpiresAt: null,
    restricted: false,
    contentText: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DocumentsService', () => {
  describe('create', () => {
    it('creates a root document with the first position step', async () => {
      const { service, metrics } = buildService();
      const result = await service.create('ws-1', 'user-1', { title: 'Root' });

      expect(result.parentId).toBeNull();
      expect(result.position).toBe(1000);
      expect(metrics.documentsCreatedTotal.inc).toHaveBeenCalled();
    });

    it('appends subsequent root documents after the previous one', async () => {
      const { service } = buildService([doc({ id: 'root-1', position: 1000 })]);
      const result = await service.create('ws-1', 'user-1', {
        title: 'Root 2',
      });

      expect(result.position).toBe(2000);
    });

    it('creates a child document scoped under its parent, independent of root positions', async () => {
      const { service } = buildService([
        doc({ id: 'root-1', position: 1000 }),
        doc({ id: 'root-2', position: 2000 }),
      ]);
      const result = await service.create('ws-1', 'user-1', {
        title: 'Child',
        parentId: 'root-1',
      });

      expect(result.parentId).toBe('root-1');
      expect(result.position).toBe(1000);
    });

    it('rejects creating under a parent from another workspace (IDOR)', async () => {
      const { service } = buildService([
        doc({ id: 'foreign-root', workspaceId: 'ws-2', position: 1000 }),
      ]);

      await expect(
        service.create('ws-1', 'user-1', {
          title: 'Child',
          parentId: 'foreign-root',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects creating under an archived parent', async () => {
      const { service } = buildService([
        doc({ id: 'root-1', position: 1000, archivedAt: new Date() }),
      ]);

      await expect(
        service.create('ws-1', 'user-1', {
          title: 'Child',
          parentId: 'root-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('excludes archived documents by default', async () => {
      const { service } = buildService([
        doc({ id: 'active', position: 1000 }),
        doc({ id: 'gone', position: 2000, archivedAt: new Date() }),
      ]);

      const result = await service.list('ws-1', false);
      expect(result.map((d) => d.id)).toEqual(['active']);
    });

    it('includes archived documents when requested', async () => {
      const { service } = buildService([
        doc({ id: 'active', position: 1000 }),
        doc({ id: 'gone', position: 2000, archivedAt: new Date() }),
      ]);

      const result = await service.list('ws-1', true);
      expect(result.map((d) => d.id).sort()).toEqual(['active', 'gone']);
    });
  });

  describe('list (Redis cache, TT gap 7)', () => {
    it('serves a cache hit without querying Postgres', async () => {
      const { service, repo, redis } = buildService([
        doc({ id: 'a', position: 1000 }),
      ]);
      const cachedDto = {
        ...doc({ id: 'cached', position: 1000 }),
        archivedAt: null,
      };
      redis.get.mockResolvedValueOnce(JSON.stringify([cachedDto]));

      const result = await service.list('ws-1', true);

      expect(result.map((d) => d.id)).toEqual(['cached']);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('writes the tree to the cache on a miss', async () => {
      const { service, redis } = buildService([
        doc({ id: 'a', position: 1000 }),
      ]);

      await service.list('ws-1', true);

      expect(redis.set).toHaveBeenCalledWith(
        'doc-tree:ws-1',
        expect.stringContaining('"a"'),
        'EX',
        60,
      );
    });

    it('invalidates the cache after a mutation (rename)', async () => {
      const { service, redis } = buildService([
        doc({ id: 'a', position: 1000 }),
      ]);

      await service.update('ws-1', 'a', { title: 'Renamed' });

      expect(redis.del).toHaveBeenCalledWith('doc-tree:ws-1');
    });

    it('falls back to Postgres if Redis read fails, without throwing', async () => {
      const { service, repo, redis } = buildService([
        doc({ id: 'a', position: 1000 }),
      ]);
      redis.get.mockRejectedValueOnce(new Error('redis down'));

      const result = await service.list('ws-1', true);

      expect(result.map((d) => d.id)).toEqual(['a']);
      expect(repo.find).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('throws 404 for a document belonging to a different workspace (IDOR)', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', workspaceId: 'ws-2' }),
      ]);

      await expect(service.get('ws-1', 'doc-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('renames the document title', async () => {
      const { service } = buildService([doc({ id: 'doc-1' })]);

      const result = await service.update('ws-1', 'doc-1', {
        title: 'New Title',
      });
      expect(result.title).toBe('New Title');
    });
  });

  describe('move', () => {
    it('rejects a document being moved under itself', async () => {
      const { service } = buildService([doc({ id: 'doc-1' })]);

      await expect(
        service.move('ws-1', 'doc-1', { parentId: 'doc-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects moving a document under one of its own descendants (cycle)', async () => {
      const { service } = buildService([
        doc({ id: 'root', position: 1000 }),
        doc({ id: 'child', parentId: 'root', position: 1000 }),
        doc({ id: 'grandchild', parentId: 'child', position: 1000 }),
      ]);

      await expect(
        service.move('ws-1', 'root', { parentId: 'grandchild' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects moving a document under a parent from another workspace (IDOR)', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', position: 1000 }),
        doc({ id: 'foreign', workspaceId: 'ws-2', position: 1000 }),
      ]);

      await expect(
        service.move('ws-1', 'doc-1', { parentId: 'foreign' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects moving under an archived parent', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', position: 1000 }),
        doc({ id: 'archived-parent', position: 2000, archivedAt: new Date() }),
      ]);

      await expect(
        service.move('ws-1', 'doc-1', { parentId: 'archived-parent' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects moving an archived document (must restore first)', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', position: 1000, archivedAt: new Date() }),
      ]);

      await expect(
        service.move('ws-1', 'doc-1', { parentId: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('appends to the end when moved to a new parent with no referenceId', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', position: 1000 }),
        doc({ id: 'parent', position: 2000 }),
        doc({ id: 'existing-child', parentId: 'parent', position: 1000 }),
      ]);

      const result = await service.move('ws-1', 'doc-1', {
        parentId: 'parent',
      });
      expect(result.parentId).toBe('parent');
      expect(result.position).toBe(2000);
    });

    it('reorders a sibling before a reference using midpoint bisection', async () => {
      const { service } = buildService([
        doc({ id: 'a', position: 1000 }),
        doc({ id: 'b', position: 2000 }),
        doc({ id: 'c', position: 3000 }),
      ]);

      const result = await service.move('ws-1', 'c', {
        parentId: null,
        referenceId: 'b',
        placement: 'before',
      });
      expect(result.position).toBe(1500);
    });

    it('reorders a sibling after a reference using midpoint bisection', async () => {
      const { service } = buildService([
        doc({ id: 'a', position: 1000 }),
        doc({ id: 'b', position: 2000 }),
        doc({ id: 'c', position: 3000 }),
      ]);

      const result = await service.move('ws-1', 'a', {
        parentId: null,
        referenceId: 'b',
        placement: 'after',
      });
      expect(result.position).toBe(2500);
    });

    it('rejects a referenceId that is not a sibling under the target parent', async () => {
      const { service } = buildService([
        doc({ id: 'a', position: 1000 }),
        doc({
          id: 'unrelated',
          parentId: null,
          position: 5000,
          workspaceId: 'ws-1',
        }),
        doc({ id: 'b', parentId: 'a', position: 1000 }),
      ]);

      await expect(
        service.move('ws-1', 'b', { parentId: 'a', referenceId: 'unrelated' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('archive', () => {
    it('cascades archival to the entire subtree', async () => {
      const { service, repo, metrics } = buildService([
        doc({ id: 'root', position: 1000 }),
        doc({ id: 'child', parentId: 'root', position: 1000 }),
        doc({ id: 'grandchild', parentId: 'child', position: 1000 }),
        doc({ id: 'sibling', position: 2000 }),
      ]);

      await service.archive('ws-1', 'root');

      const archivedIds = repo.rows
        .filter((r) => r.archivedAt)
        .map((r) => r.id);
      expect(archivedIds.sort()).toEqual(['child', 'grandchild', 'root']);
      expect(repo.rows.find((r) => r.id === 'sibling')?.archivedAt).toBeNull();
      expect(metrics.documentsArchivedTotal.inc).toHaveBeenCalled();
    });

    it('throws 404 archiving a document from another workspace (IDOR)', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', workspaceId: 'ws-2' }),
      ]);

      await expect(service.archive('ws-1', 'doc-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('restore', () => {
    it('cascades restoration to the entire archived subtree', async () => {
      const now = new Date();
      const { service, repo } = buildService([
        doc({ id: 'root', position: 1000, archivedAt: now }),
        doc({ id: 'child', parentId: 'root', position: 1000, archivedAt: now }),
        doc({
          id: 'grandchild',
          parentId: 'child',
          position: 1000,
          archivedAt: now,
        }),
      ]);

      await service.restore('ws-1', 'root');

      expect(repo.rows.every((r) => r.archivedAt === null)).toBe(true);
    });

    it('keeps the original position when the parent is unchanged (no unnecessary reorder)', async () => {
      const now = new Date();
      const { service, repo } = buildService([
        doc({ id: 'other-root', position: 1000 }),
        doc({ id: 'root', position: 5000, archivedAt: now }),
      ]);

      const result = await service.restore('ws-1', 'root');

      expect(result.parentId).toBeNull();
      expect(result.position).toBe(5000);
      expect(repo.rows.find((r) => r.id === 'root')?.position).toBe(5000);
    });

    it('reparents to root and recomputes position when the original parent is still archived', async () => {
      const now = new Date();
      const { service } = buildService([
        doc({ id: 'parent', position: 1000, archivedAt: now }),
        doc({
          id: 'child',
          parentId: 'parent',
          position: 1000,
          archivedAt: now,
        }),
        doc({ id: 'existing-root', position: 3000 }),
      ]);

      const result = await service.restore('ws-1', 'child');

      expect(result.parentId).toBeNull();
      expect(result.position).toBe(4000);
    });

    it('reparents to root when the original parent no longer exists', async () => {
      const now = new Date();
      const { service } = buildService([
        doc({
          id: 'orphan',
          parentId: 'deleted-parent',
          position: 1000,
          archivedAt: now,
        }),
      ]);

      const result = await service.restore('ws-1', 'orphan');
      expect(result.parentId).toBeNull();
    });

    it('throws 404 restoring a document from another workspace (IDOR)', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', workspaceId: 'ws-2', archivedAt: new Date() }),
      ]);

      await expect(service.restore('ws-1', 'doc-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('publish', () => {
    it('publishes a document, generating a slug from the title', async () => {
      const { service, metrics, revalidation } = buildService([
        doc({ id: 'doc-1', title: 'My Great Doc' }),
      ]);

      const result = await service.publish('ws-1', 'doc-1', {});

      expect(result.isPublished).toBe(true);
      expect(result.publicSlug).toBe('my-great-doc');
      expect(result.publishedAt).not.toBeNull();
      expect(metrics.documentsPublishedTotal.inc).toHaveBeenCalled();
      expect(revalidation.revalidateSlug).toHaveBeenCalledWith('my-great-doc');
    });

    it('normalizes a custom slug via slugify', async () => {
      const { service } = buildService([doc({ id: 'doc-1' })]);

      const result = await service.publish('ws-1', 'doc-1', {
        slug: 'Custom Slug!!',
      });

      expect(result.publicSlug).toBe('custom-slug');
    });

    it('rejects publishing an archived document', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', archivedAt: new Date() }),
      ]);

      await expect(service.publish('ws-1', 'doc-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('appends a random suffix when the requested slug is already taken by another document', async () => {
      const { service } = buildService([
        doc({
          id: 'doc-1',
          title: 'Same Title',
          publicSlug: 'same-title',
          isPublished: true,
        }),
        doc({ id: 'doc-2', title: 'Same Title' }),
      ]);

      const result = await service.publish('ws-1', 'doc-2', {});

      expect(result.publicSlug).not.toBe('same-title');
      expect(result.publicSlug).toMatch(/^same-title-[0-9a-f]+$/);
    });

    it('re-publishing with no new slug keeps the existing slug (idempotent republish)', async () => {
      const { service, revalidation } = buildService([
        doc({ id: 'doc-1', publicSlug: 'existing-slug', isPublished: false }),
      ]);

      const result = await service.publish('ws-1', 'doc-1', {});

      expect(result.publicSlug).toBe('existing-slug');
      // No "previous slug" revalidation call, since the slug didn't change.
      expect(revalidation.revalidateSlug).toHaveBeenCalledTimes(1);
      expect(revalidation.revalidateSlug).toHaveBeenCalledWith('existing-slug');
    });

    it('changing the slug on republish revalidates both the old and new slugs', async () => {
      const { service, revalidation } = buildService([
        doc({ id: 'doc-1', publicSlug: 'old-slug', isPublished: true }),
      ]);

      await service.publish('ws-1', 'doc-1', { slug: 'new-slug' });

      expect(revalidation.revalidateSlug).toHaveBeenCalledWith('old-slug');
      expect(revalidation.revalidateSlug).toHaveBeenCalledWith('new-slug');
    });

    it('throws 404 publishing a document from another workspace (IDOR)', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', workspaceId: 'ws-2' }),
      ]);

      await expect(service.publish('ws-1', 'doc-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('unpublish', () => {
    it('unpublishes a published document', async () => {
      const { service, metrics, revalidation } = buildService([
        doc({ id: 'doc-1', isPublished: true, publicSlug: 'slug-1' }),
      ]);

      const result = await service.unpublish('ws-1', 'doc-1');

      expect(result.isPublished).toBe(false);
      expect(result.publishedAt).toBeNull();
      expect(metrics.documentsUnpublishedTotal.inc).toHaveBeenCalled();
      expect(revalidation.revalidateSlug).toHaveBeenCalledWith('slug-1');
    });

    it('is idempotent - unpublishing an already-unpublished document is a no-op', async () => {
      const { service, metrics, revalidation } = buildService([
        doc({ id: 'doc-1', isPublished: false }),
      ]);

      await service.unpublish('ws-1', 'doc-1');

      expect(metrics.documentsUnpublishedTotal.inc).not.toHaveBeenCalled();
      expect(revalidation.revalidateSlug).not.toHaveBeenCalled();
    });

    it('throws 404 unpublishing a document from another workspace (IDOR)', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', workspaceId: 'ws-2', isPublished: true }),
      ]);

      await expect(service.unpublish('ws-1', 'doc-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archive auto-unpublishes the whole subtree', () => {
    it('clears isPublished/publishedAt and revalidates every published slug in the subtree', async () => {
      const { service, metrics, revalidation } = buildService([
        doc({ id: 'root', isPublished: true, publicSlug: 'root-slug' }),
        doc({
          id: 'child',
          parentId: 'root',
          isPublished: true,
          publicSlug: 'child-slug',
        }),
        doc({ id: 'grandchild', parentId: 'child' }), // never published
      ]);

      await service.archive('ws-1', 'root');

      expect(metrics.documentsUnpublishedTotal.inc).toHaveBeenCalledWith(2);
      expect(revalidation.revalidateSlug).toHaveBeenCalledWith('root-slug');
      expect(revalidation.revalidateSlug).toHaveBeenCalledWith('child-slug');
    });

    it('does not touch documentsUnpublishedTotal when nothing in the subtree was published', async () => {
      const { service, metrics, revalidation } = buildService([
        doc({ id: 'root' }),
      ]);

      await service.archive('ws-1', 'root');

      expect(metrics.documentsUnpublishedTotal.inc).not.toHaveBeenCalled();
      expect(revalidation.revalidateSlug).not.toHaveBeenCalled();
    });
  });

  describe('findPublishedBySlug', () => {
    it('finds a published, non-archived document by slug', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', isPublished: true, publicSlug: 'my-slug' }),
      ]);

      const result = await service.findPublishedBySlug('my-slug');
      expect(result?.id).toBe('doc-1');
    });

    it('returns null for an unpublished document even if the slug is set', async () => {
      const { service } = buildService([
        doc({ id: 'doc-1', isPublished: false, publicSlug: 'my-slug' }),
      ]);

      expect(await service.findPublishedBySlug('my-slug')).toBeNull();
    });

    it('returns null for a nonexistent slug', async () => {
      const { service } = buildService([]);
      expect(await service.findPublishedBySlug('nope')).toBeNull();
    });

    it('returns null for an archived document, even if isPublished was left true (defense in depth)', async () => {
      const { service } = buildService([
        doc({
          id: 'doc-1',
          isPublished: true,
          publicSlug: 'my-slug',
          archivedAt: new Date(),
        }),
      ]);

      expect(await service.findPublishedBySlug('my-slug')).toBeNull();
    });
  });
});

// Sanity check that the operators we rely on in the fake repo behave like
// real TypeORM operators, so the fake stays representative of production.
describe('FindOperator sanity', () => {
  it('IsNull() and In() carry a type/value shape', () => {
    expect(IsNull().type).toBe('isNull');
    expect(In(['a', 'b']).type).toBe('in');
    expect(In(['a', 'b']).value).toEqual(['a', 'b']);
  });
});
