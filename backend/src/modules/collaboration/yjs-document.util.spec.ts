import * as Y from 'yjs';
import {
  decodeState,
  encodeBlocksSnapshot,
  getBlocksArray,
  replaceBlocksContent,
} from './yjs-document.util';

function makeParagraph(id: string, text: string): Y.Map<unknown> {
  const block = new Y.Map<unknown>();
  block.set('id', id);
  block.set('type', 'paragraph');
  const ytext = new Y.Text();
  ytext.insert(0, text);
  block.set('text', ytext);
  return block;
}

function makeCheckbox(
  id: string,
  text: string,
  checked: boolean,
): Y.Map<unknown> {
  const block = new Y.Map<unknown>();
  block.set('id', id);
  block.set('type', 'checkbox');
  const ytext = new Y.Text();
  ytext.insert(0, text);
  block.set('text', ytext);
  block.set('checked', checked);
  return block;
}

describe('decodeState', () => {
  it('reconstructs an equivalent doc from encoded state', () => {
    const original = new Y.Doc();
    getBlocksArray(original).insert(0, [makeParagraph('b1', 'hello')]);
    const state = Y.encodeStateAsUpdate(original);

    const decoded = decodeState(state);

    expect(getBlocksArray(decoded).toArray()).toHaveLength(1);
    const text = getBlocksArray(decoded).get(0).get('text') as Y.Text;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- yjs's .d.ts omits YText's toString() override; it exists and works at runtime.
    expect(text.toString()).toBe('hello');
  });

  it('returns an empty doc for empty state bytes', () => {
    const decoded = decodeState(new Uint8Array());
    expect(getBlocksArray(decoded).toArray()).toHaveLength(0);
  });
});

describe('encodeBlocksSnapshot', () => {
  it('serializes text blocks to plain strings', () => {
    const doc = new Y.Doc();
    getBlocksArray(doc).insert(0, [makeParagraph('b1', 'hello world')]);

    const snapshot = encodeBlocksSnapshot(doc);

    expect(snapshot).toEqual([
      { id: 'b1', type: 'paragraph', text: 'hello world' },
    ]);
  });

  it('includes checked for checkbox blocks', () => {
    const doc = new Y.Doc();
    getBlocksArray(doc).insert(0, [makeCheckbox('b1', 'buy milk', true)]);

    const snapshot = encodeBlocksSnapshot(doc);

    expect(snapshot).toEqual([
      { id: 'b1', type: 'checkbox', text: 'buy milk', checked: true },
    ]);
  });

  it('returns an empty array for an empty document', () => {
    expect(encodeBlocksSnapshot(new Y.Doc())).toEqual([]);
  });
});

describe('replaceBlocksContent', () => {
  it('replaces the target doc entire block list with a clone of the source', () => {
    const target = new Y.Doc();
    getBlocksArray(target).insert(0, [makeParagraph('old', 'old content')]);

    const source = new Y.Doc();
    getBlocksArray(source).insert(0, [
      makeParagraph('new', 'restored content'),
    ]);

    replaceBlocksContent(target, source);

    const result = encodeBlocksSnapshot(target);
    expect(result).toEqual([
      { id: 'new', type: 'paragraph', text: 'restored content' },
    ]);
  });

  it('clears the target when the source has no blocks', () => {
    const target = new Y.Doc();
    getBlocksArray(target).insert(0, [makeParagraph('old', 'old content')]);

    replaceBlocksContent(target, new Y.Doc());

    expect(getBlocksArray(target).toArray()).toHaveLength(0);
  });

  it('the pre/post state-vector diff alone is enough to reconstruct the restored content', () => {
    const target = new Y.Doc();
    getBlocksArray(target).insert(0, [makeParagraph('old', 'old content')]);
    const beforeStateVector = Y.encodeStateVector(target);
    const beforeFullState = Y.encodeStateAsUpdate(target);

    const source = new Y.Doc();
    getBlocksArray(source).insert(0, [
      makeParagraph('new', 'restored content'),
    ]);
    replaceBlocksContent(target, source);

    const diff = Y.encodeStateAsUpdate(target, beforeStateVector);

    // A client that only had the pre-restore state should converge to the
    // exact restored content once given just this diff (what the gateway
    // actually broadcasts to connected clients on restore).
    const remoteClient = new Y.Doc();
    Y.applyUpdate(remoteClient, beforeFullState);
    Y.applyUpdate(remoteClient, diff);
    expect(encodeBlocksSnapshot(remoteClient)).toEqual(
      encodeBlocksSnapshot(target),
    );
  });

  it('clones Y.Text content rather than sharing references across docs', () => {
    const target = new Y.Doc();
    const source = new Y.Doc();
    getBlocksArray(source).insert(0, [makeParagraph('a', 'shared?')]);

    replaceBlocksContent(target, source);

    const clonedText = getBlocksArray(target).get(0).get('text') as Y.Text;
    expect(clonedText.doc).toBe(target);
    clonedText.insert(clonedText.length, '!');
    const sourceText = getBlocksArray(source).get(0).get('text') as Y.Text;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- yjs's .d.ts omits YText's toString() override; it exists and works at runtime.
    expect(sourceText.toString()).toBe('shared?'); // source unaffected by mutating the clone
  });
});
