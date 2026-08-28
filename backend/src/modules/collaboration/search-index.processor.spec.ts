import * as Y from 'yjs';
import { SearchIndexProcessor } from './search-index.processor';

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

function buildProcessor(state: Uint8Array | null) {
  const persistence = { hydrate: jest.fn().mockResolvedValue(state) };
  const documentsService = { updateSearchContent: jest.fn() };
  const logger = { setContext: jest.fn(), warn: jest.fn() };
  const metrics = { searchIndexJobsTotal: { inc: jest.fn() } };

  const processor = new SearchIndexProcessor(
    persistence as never,
    documentsService as never,
    logger as never,
    metrics as never,
  );

  return { processor, persistence, documentsService, metrics };
}

describe('SearchIndexProcessor', () => {
  it('re-reads the durable buffer and updates the search index (TT gap 6)', async () => {
    const { processor, documentsService, metrics } = buildProcessor(
      validYjsState('async indexed text'),
    );

    await processor.process({ data: { documentId: 'doc-1' } } as never);

    expect(documentsService.updateSearchContent).toHaveBeenCalledWith(
      'doc-1',
      'async indexed text',
    );
    expect(metrics.searchIndexJobsTotal.inc).toHaveBeenCalledWith({
      result: 'success',
    });
  });

  it('is idempotent - processing the same job twice converges on the same write', async () => {
    const { processor, documentsService } = buildProcessor(
      validYjsState('stable content'),
    );

    await processor.process({ data: { documentId: 'doc-1' } } as never);
    await processor.process({ data: { documentId: 'doc-1' } } as never);

    expect(documentsService.updateSearchContent).toHaveBeenCalledTimes(2);
    expect(documentsService.updateSearchContent).toHaveBeenNthCalledWith(
      1,
      'doc-1',
      'stable content',
    );
    expect(documentsService.updateSearchContent).toHaveBeenNthCalledWith(
      2,
      'doc-1',
      'stable content',
    );
  });

  it('skips (does not throw) when no durable buffer exists yet', async () => {
    const { processor, documentsService, metrics } = buildProcessor(null);

    await processor.process({ data: { documentId: 'doc-1' } } as never);

    expect(documentsService.updateSearchContent).not.toHaveBeenCalled();
    expect(metrics.searchIndexJobsTotal.inc).toHaveBeenCalledWith({
      result: 'skipped',
    });
  });

  it('re-throws on failure so BullMQ retries, and records the failure metric', async () => {
    const { processor, documentsService, metrics } = buildProcessor(
      validYjsState('will fail'),
    );
    documentsService.updateSearchContent.mockRejectedValueOnce(
      new Error('db down'),
    );

    await expect(
      processor.process({ data: { documentId: 'doc-1' } } as never),
    ).rejects.toThrow('db down');
    expect(metrics.searchIndexJobsTotal.inc).toHaveBeenCalledWith({
      result: 'error',
    });
  });
});
