import { NotFoundException } from '@nestjs/common';
import * as Y from 'yjs';
import { PublicDocumentsService } from './public-documents.service';

function buildService(options: {
  document?: {
    id: string;
    title: string;
    publishedAt: Date;
    publicAccessMode?: 'view' | 'edit';
  } | null;
  hydrateState?: Uint8Array | null;
  hydrateError?: Error;
}) {
  const documentsService = {
    findPublishedBySlug: jest.fn(() =>
      Promise.resolve(options.document ?? null),
    ),
  };
  const persistence = {
    hydrate: jest.fn(() => {
      if (options.hydrateError) throw options.hydrateError;
      return Promise.resolve(options.hydrateState ?? null);
    }),
  };
  const logger = { setContext: jest.fn(), warn: jest.fn() };
  const metrics = { publicRenderFailuresTotal: { inc: jest.fn() } };

  const service = new PublicDocumentsService(
    documentsService as never,
    persistence as never,
    logger as never,
    metrics as never,
  );

  return { service, documentsService, persistence, metrics };
}

function encodedStateWithText(text: string): Uint8Array {
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

describe('PublicDocumentsService', () => {
  it('throws 404 for a slug that is not published', async () => {
    const { service } = buildService({ document: null });
    await expect(service.getPublished('nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns title/blocks/publishedAt decoded from the durable buffer', async () => {
    const publishedAt = new Date();
    const { service } = buildService({
      document: { id: 'doc-1', title: 'Hello', publishedAt },
      hydrateState: encodedStateWithText('hello world'),
    });

    const result = await service.getPublished('hello');

    expect(result.title).toBe('Hello');
    expect(result.publishedAt).toBe(publishedAt);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].text).toBe('hello world');
  });

  it('returns an empty blocks array for a published document with no durable state yet', async () => {
    const { service } = buildService({
      document: { id: 'doc-1', title: 'Empty', publishedAt: new Date() },
      hydrateState: null,
    });

    const result = await service.getPublished('empty');
    expect(result.blocks).toEqual([]);
  });

  it('never exposes workspaceId/documentId/authorId in the response shape', async () => {
    const { service } = buildService({
      document: { id: 'doc-1', title: 'Hello', publishedAt: new Date() },
      hydrateState: null,
    });

    const result = await service.getPublished('hello');
    expect(Object.keys(result).sort()).toEqual(
      ['blocks', 'mode', 'publishedAt', 'title'].sort(),
    );
  });

  it('includes the public access mode (TT gap 2) so the frontend knows whether to render read-only or editable', async () => {
    const { service } = buildService({
      document: {
        id: 'doc-1',
        title: 'Hello',
        publishedAt: new Date(),
        publicAccessMode: 'edit',
      },
      hydrateState: null,
    });

    const result = await service.getPublished('hello');
    expect(result.mode).toBe('edit');
  });

  it('increments publicRenderFailuresTotal and rethrows on a hydrate error', async () => {
    const { service, metrics } = buildService({
      document: { id: 'doc-1', title: 'Hello', publishedAt: new Date() },
      hydrateError: new Error('db down'),
    });

    await expect(service.getPublished('hello')).rejects.toThrow('db down');
    expect(metrics.publicRenderFailuresTotal.inc).toHaveBeenCalled();
  });
});
