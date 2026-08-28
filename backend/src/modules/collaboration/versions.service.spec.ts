import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as Y from 'yjs';
import { DocumentVersionKind } from './document-version-kind.enum';
import { VersionsService } from './versions.service';

function makeParagraphState(text: string): Uint8Array {
  const doc = new Y.Doc();
  const block = new Y.Map<unknown>();
  block.set('id', 'b1');
  block.set('type', 'paragraph');
  const ytext = new Y.Text();
  ytext.insert(0, text);
  block.set('text', ytext);
  doc.getArray('blocks').insert(0, [block]);
  return Y.encodeStateAsUpdate(doc);
}

function buildService(seed: Record<string, unknown>[] = []) {
  const rows = [...seed];
  let seq = rows.length;

  const repo = {
    find: jest.fn(
      ({
        where,
      }: {
        where: {
          documentId: string;
          kind: { _type: string; value: string[] } | string;
        };
      }) => {
        return rows.filter((r) => {
          if (r.documentId !== where.documentId) return false;
          const kindFilter = where.kind;
          if (typeof kindFilter === 'string') return r.kind === kindFilter;
          return (kindFilter as { value: string[] }).value.includes(
            r.kind as string,
          );
        });
      },
    ),
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      return (
        rows.find((r) =>
          Object.entries(where).every(([key, value]) => r[key] === value),
        ) ?? null
      );
    }),
    save: jest.fn((entity: Record<string, unknown>) => {
      if (!entity.id) {
        entity.id = `version-${++seq}`;
        entity.createdAt = entity.createdAt ?? new Date();
        rows.push(entity);
      }
      return entity;
    }),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
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
      firstName: 'Test',
      lastName: 'User',
    })),
  };
  const collaborationService = { getSession: jest.fn(() => undefined) };
  const persistence = { hydrate: jest.fn(() => null) };
  const gateway = { applyRestoredState: jest.fn(() => undefined) };
  const metrics = {
    collabVersionsCreatedTotal: { inc: jest.fn() },
    collabVersionRestoreTotal: { inc: jest.fn() },
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };

  const service = new VersionsService(
    repo as never,
    documentsService as never,
    usersService as never,
    collaborationService as never,
    persistence as never,
    gateway as never,
    metrics as never,
    logger as never,
  );

  return {
    service,
    repo,
    rows,
    documentsService,
    collaborationService,
    persistence,
    gateway,
    metrics,
  };
}

describe('VersionsService', () => {
  describe('list', () => {
    it('excludes AUTO rows from the user-facing history', async () => {
      const { service } = buildService([
        {
          id: 'v1',
          documentId: 'doc-1',
          kind: DocumentVersionKind.AUTO,
          createdById: null,
          label: null,
          createdAt: new Date(),
        },
        {
          id: 'v2',
          documentId: 'doc-1',
          kind: DocumentVersionKind.MANUAL,
          createdById: 'u1',
          label: 'A',
          createdAt: new Date(),
        },
      ]);

      const result = await service.list('ws-1', 'doc-1');

      expect(result.map((v) => v.id)).toEqual(['v2']);
    });

    it('resolves author display names', async () => {
      const { service } = buildService([
        {
          id: 'v1',
          documentId: 'doc-1',
          kind: DocumentVersionKind.MANUAL,
          createdById: 'u1',
          label: 'A',
          createdAt: new Date(),
        },
      ]);

      const result = await service.list('ws-1', 'doc-1');

      expect(result[0].authorName).toBe('Test User');
    });

    it('propagates the 404 from a cross-workspace/missing document', async () => {
      const { service, documentsService } = buildService();
      documentsService.get.mockRejectedValueOnce(
        new NotFoundException('Document not found'),
      );

      await expect(service.list('ws-1', 'doc-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('inspect', () => {
    it('decodes stored state into plain blocks', async () => {
      const { service } = buildService([
        {
          id: 'v1',
          documentId: 'doc-1',
          kind: DocumentVersionKind.MANUAL,
          createdById: 'u1',
          label: 'A',
          createdAt: new Date(),
          state: Buffer.from(makeParagraphState('hello')),
        },
      ]);

      const result = await service.inspect('ws-1', 'doc-1', 'v1');

      expect(result.blocks).toEqual([
        { id: 'b1', type: 'paragraph', text: 'hello' },
      ]);
    });

    it('throws 404 for a version belonging to a different document (IDOR)', async () => {
      const { service } = buildService([
        {
          id: 'v1',
          documentId: 'other-doc',
          kind: DocumentVersionKind.MANUAL,
          createdById: 'u1',
          label: 'A',
          createdAt: new Date(),
          state: Buffer.from(makeParagraphState('hello')),
        },
      ]);

      await expect(service.inspect('ws-1', 'doc-1', 'v1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('snapshots the live session state when one is active', async () => {
      const { service, collaborationService, rows } = buildService();
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, makeParagraphState('live content'));
      collaborationService.getSession.mockReturnValueOnce({
        ydoc,
        awareness: {},
      });

      await service.create('ws-1', 'doc-1', 'u1', 'My snapshot');

      const saved = rows.find((r) => r.kind === DocumentVersionKind.MANUAL);
      expect(saved).toBeDefined();
      expect(saved!.label).toBe('My snapshot');
    });

    it('falls back to the durable buffer when no live session exists', async () => {
      const { service, persistence, rows } = buildService();
      persistence.hydrate.mockResolvedValueOnce(
        makeParagraphState('persisted content'),
      );

      await service.create('ws-1', 'doc-1', 'u1', undefined);

      expect(rows).toHaveLength(1);
    });

    it('rejects snapshotting an archived document', async () => {
      const { service, documentsService } = buildService();
      documentsService.get.mockResolvedValueOnce({
        id: 'doc-1',
        archivedAt: new Date(),
      });

      await expect(
        service.create('ws-1', 'doc-1', 'u1', undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('restore', () => {
    it('preserves current state as a restore-point before applying the target', async () => {
      const targetState = Buffer.from(makeParagraphState('old content'));
      const { service, rows, gateway } = buildService([
        {
          id: 'target',
          documentId: 'doc-1',
          kind: DocumentVersionKind.MANUAL,
          createdById: 'u1',
          label: 'Target',
          createdAt: new Date(),
          state: targetState,
        },
      ]);

      const result = await service.restore('ws-1', 'doc-1', 'target', 'u2');

      const restorePoints = rows.filter(
        (r) => r.kind === DocumentVersionKind.RESTORE_POINT,
      );
      expect(restorePoints).toHaveLength(1);
      expect(result.restoredFromVersionId).toBe('target');
      expect(result.historyVersionId).toBe(restorePoints[0].id);
      expect(gateway.applyRestoredState).toHaveBeenCalledWith(
        'doc-1',
        new Uint8Array(targetState),
      );
    });

    it('throws 404 for an unknown version id', async () => {
      const { service } = buildService();
      await expect(
        service.restore('ws-1', 'doc-1', 'missing', 'u1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects restoring on an archived document', async () => {
      const { service, documentsService } = buildService([
        {
          id: 'target',
          documentId: 'doc-1',
          kind: DocumentVersionKind.MANUAL,
          createdById: 'u1',
          label: 'Target',
          createdAt: new Date(),
          state: Buffer.from(makeParagraphState('x')),
        },
      ]);
      documentsService.get.mockResolvedValueOnce({
        id: 'doc-1',
        archivedAt: new Date(),
      });

      await expect(
        service.restore('ws-1', 'doc-1', 'target', 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not create a restore-point if the target version does not exist', async () => {
      const { service, rows } = buildService();

      await expect(
        service.restore('ws-1', 'doc-1', 'missing', 'u1'),
      ).rejects.toThrow();
      expect(rows).toHaveLength(0);
    });
  });
});
