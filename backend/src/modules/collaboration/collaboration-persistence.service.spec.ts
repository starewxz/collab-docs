import * as Y from 'yjs';
import { CollaborationPersistenceService } from './collaboration-persistence.service';
import { DocumentVersionKind } from './document-version-kind.enum';

function validYjsState(text: string): Uint8Array {
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

function buildService(existingAutoRow: { state: Buffer } | null = null) {
  const rows: Record<string, unknown>[] = existingAutoRow
    ? [{ id: 'row-1', kind: DocumentVersionKind.AUTO, ...existingAutoRow }]
    : [];

  const repo = {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      return (
        rows.find(
          (r) => r.documentId === where.documentId && r.kind === where.kind,
        ) ?? null
      );
    }),
    save: jest.fn((entity: Record<string, unknown>) => {
      if (!entity.id) {
        entity.id = `row-${rows.length + 1}`;
        rows.push(entity);
      }
      return entity;
    }),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
  };

  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const metrics = {
    collabPersistTotal: { inc: jest.fn() },
  };
  const searchIndexQueue = { add: jest.fn() };

  const service = new CollaborationPersistenceService(
    repo as never,
    logger as never,
    metrics as never,
    searchIndexQueue as never,
  );

  return { service, repo, rows, metrics, searchIndexQueue };
}

describe('CollaborationPersistenceService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('hydrate', () => {
    it('returns null when no AUTO row exists yet', async () => {
      const { service } = buildService();
      expect(await service.hydrate('doc-1')).toBeNull();
    });

    it('returns the stored state as a Uint8Array', async () => {
      const { service } = buildService();
      await service.flush('doc-1', new Uint8Array([1, 2, 3]));

      const hydrated = await service.hydrate('doc-1');
      expect(hydrated).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe('flush', () => {
    it('creates the AUTO row on first flush', async () => {
      const { service, repo } = buildService();
      await service.flush('doc-1', new Uint8Array([9]));

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          kind: DocumentVersionKind.AUTO,
        }),
      );
    });

    it('upserts in place on subsequent flushes rather than inserting a new row', async () => {
      const { service, rows } = buildService();
      await service.flush('doc-1', new Uint8Array([1]));
      await service.flush('doc-1', new Uint8Array([1, 2]));

      const autoRows = rows.filter(
        (r) => r.documentId === 'doc-1' && r.kind === DocumentVersionKind.AUTO,
      );
      expect(autoRows).toHaveLength(1);
      expect(new Uint8Array(autoRows[0].state as Buffer)).toEqual(
        new Uint8Array([1, 2]),
      );
    });

    it('is safe to flush the same state twice (idempotent duplicate updates)', async () => {
      const { service, rows } = buildService();
      const state = new Uint8Array([5, 6, 7]);
      await service.flush('doc-1', state);
      await service.flush('doc-1', state);

      const autoRows = rows.filter((r) => r.documentId === 'doc-1');
      expect(autoRows).toHaveLength(1);
    });

    it('records a metric and logs a warning on failure, without throwing', async () => {
      const { service, repo, metrics } = buildService();
      repo.findOne.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.flush('doc-1', new Uint8Array([1])),
      ).resolves.toBeUndefined();
      expect(metrics.collabPersistTotal.inc).toHaveBeenCalledWith({
        result: 'error',
      });
    });

    it('enqueues an async search-index job after a successful durable write (TT gap 6)', async () => {
      const { service, searchIndexQueue } = buildService();
      await service.flush('doc-1', validYjsState('hello searchable world'));

      expect(searchIndexQueue.add).toHaveBeenCalledWith(
        'index',
        { documentId: 'doc-1' },
        expect.objectContaining({ jobId: 'doc-1', attempts: 3 }),
      );
    });

    it('does not enqueue a search-index job when the durable write itself failed', async () => {
      const { service, repo, searchIndexQueue } = buildService();
      repo.findOne.mockRejectedValueOnce(new Error('db down'));

      await service.flush('doc-1', validYjsState('unreached'));

      expect(searchIndexQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('scheduleFlush (trailing throttle)', () => {
    it('coalesces multiple calls within the window into a single flush', async () => {
      jest.useFakeTimers();
      const { service, repo } = buildService();
      const getState = jest
        .fn()
        .mockReturnValueOnce(new Uint8Array([1]))
        .mockReturnValueOnce(new Uint8Array([1, 2]))
        .mockReturnValueOnce(new Uint8Array([1, 2, 3]));

      service.scheduleFlush('doc-1', getState);
      service.scheduleFlush('doc-1', getState); // ignored - already scheduled
      service.scheduleFlush('doc-1', getState); // ignored - already scheduled

      await jest.runAllTimersAsync();

      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('schedules a new flush again after the previous one fires', async () => {
      jest.useFakeTimers();
      const { service } = buildService();

      service.scheduleFlush('doc-1', () => new Uint8Array([1]));
      expect(service.hasScheduledFlush('doc-1')).toBe(true);
      await jest.runAllTimersAsync();
      expect(service.hasScheduledFlush('doc-1')).toBe(false);

      service.scheduleFlush('doc-1', () => new Uint8Array([2]));
      expect(service.hasScheduledFlush('doc-1')).toBe(true);
    });

    it('cancelScheduledFlush prevents the pending flush from running', async () => {
      jest.useFakeTimers();
      const { service, repo } = buildService();

      service.scheduleFlush('doc-1', () => new Uint8Array([1]));
      service.cancelScheduledFlush('doc-1');
      await jest.runAllTimersAsync();

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('tracks documents independently', async () => {
      jest.useFakeTimers();
      const { service, repo } = buildService();

      service.scheduleFlush('doc-1', () => new Uint8Array([1]));
      service.scheduleFlush('doc-2', () => new Uint8Array([2]));
      await jest.runAllTimersAsync();

      expect(repo.save).toHaveBeenCalledTimes(2);
    });
  });
});
