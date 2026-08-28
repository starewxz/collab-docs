import * as Y from "yjs";
import type { BlockType } from "./types";

/** The 5-6 block types Stage 4 supports - not a full Notion editor. Each
 * text-bearing block owns a Y.Text so concurrent keystrokes inside it merge
 * character-by-character; non-text fields (checked, image metadata) are
 * plain Y.Map values with last-write-wins semantics at the field level. */
export function createBlock(type: BlockType): Y.Map<unknown> {
  const block = new Y.Map<unknown>();
  block.set("id", crypto.randomUUID());
  block.set("type", type);

  switch (type) {
    case "checkbox":
      block.set("text", new Y.Text());
      block.set("checked", false);
      break;
    case "heading":
      block.set("text", new Y.Text());
      block.set("level", 1);
      break;
    case "codeBlock":
      block.set("text", new Y.Text());
      block.set("language", "plaintext");
      break;
    case "image":
      block.set("imageUrl", "");
      block.set("imageAlt", "");
      break;
    case "paragraph":
    case "bulletListItem":
    default:
      block.set("text", new Y.Text());
      break;
  }

  return block;
}

export function getBlocksArray(ydoc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return ydoc.getArray<Y.Map<unknown>>("blocks");
}

export function insertBlockAt(
  blocks: Y.Array<Y.Map<unknown>>,
  index: number,
  type: BlockType,
): void {
  blocks.doc!.transact(() => {
    blocks.insert(index, [createBlock(type)]);
  });
}

export function removeBlockAt(blocks: Y.Array<Y.Map<unknown>>, index: number): void {
  blocks.doc!.transact(() => {
    blocks.delete(index, 1);
  });
}
