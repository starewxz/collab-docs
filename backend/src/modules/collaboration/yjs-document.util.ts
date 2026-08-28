import * as Y from 'yjs';

/**
 * Mirrors the block shape in `frontend/src/features/collaboration/blocks.ts`
 * just enough to clone content between Y.Doc instances for restore, and to
 * produce a plain, JSON-serializable preview for the "inspect version" REST
 * endpoint. The backend does not otherwise understand or validate block
 * semantics - this is a narrow, mechanical coupling, documented in
 * docs/ai/08-decisions.md. If the frontend's block schema changes, this
 * file must change with it.
 */
export interface PlainBlock {
  id: string;
  type: string;
  text?: string;
  checked?: boolean;
  level?: number;
  language?: string;
  imageUrl?: string;
  imageAlt?: string;
}

const BLOCKS_KEY = 'blocks';

export function decodeState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (state.length > 0) {
    Y.applyUpdate(doc, state);
  }
  return doc;
}

export function getBlocksArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>(BLOCKS_KEY);
}

export function encodeBlocksSnapshot(doc: Y.Doc): PlainBlock[] {
  return getBlocksArray(doc)
    .toArray()
    .map((block) => {
      const text = block.get('text');
      const plain: PlainBlock = {
        id: block.get('id') as string,
        type: block.get('type') as string,
      };
      // yjs's shipped .d.ts doesn't declare YText's toString() override (it
      // exists and works correctly at runtime - verified in tests/manual
      // smoke testing), so eslint sees only Object.prototype.toString here.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      if (text instanceof Y.Text) plain.text = text.toString();
      if (block.has('checked')) plain.checked = Boolean(block.get('checked'));
      if (block.has('level')) plain.level = block.get('level') as number;
      if (block.has('language'))
        plain.language = block.get('language') as string;
      if (block.has('imageUrl'))
        plain.imageUrl = block.get('imageUrl') as string;
      if (block.has('imageAlt'))
        plain.imageAlt = block.get('imageAlt') as string;
      return plain;
    });
}

/** Deep-clones one block into a fresh Y.Map suitable for insertion into a
 * different Y.Doc's blocks array - Yjs shared types belong to exactly one
 * doc, so cross-doc reuse always requires reconstructing fresh instances
 * from plain values, never copying references. */
function cloneBlock(source: Y.Map<unknown>): Y.Map<unknown> {
  const clone = new Y.Map<unknown>();
  source.forEach((value, key) => {
    if (value instanceof Y.Text) {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- see note above
      clone.set(key, new Y.Text(value.toString()));
    } else {
      clone.set(key, value);
    }
  });
  return clone;
}

/**
 * Replaces `targetDoc`'s entire block list with a fresh clone of
 * `sourceDoc`'s blocks, inside one transaction. This is a content-level
 * replace (delete-all then insert), not a raw `Y.applyUpdate` merge -
 * CRDT updates can only ever add operations, never remove them, so merging
 * an old snapshot into a newer doc cannot "undo" edits made since. Content
 * replacement is the correct, standard way to implement "restore" on top
 * of a CRDT. The caller is responsible for diffing/broadcasting the
 * resulting change to connected clients.
 */
export function replaceBlocksContent(targetDoc: Y.Doc, sourceDoc: Y.Doc): void {
  const sourceBlocks = getBlocksArray(sourceDoc);
  const clones = sourceBlocks.toArray().map(cloneBlock);
  targetDoc.transact(() => {
    const targetBlocks = getBlocksArray(targetDoc);
    targetBlocks.delete(0, targetBlocks.length);
    if (clones.length > 0) {
      targetBlocks.insert(0, clones);
    }
  });
}
