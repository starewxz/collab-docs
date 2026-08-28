"use client";

import { useCallback, useMemo } from "react";
import { Spinner } from "@/components/ui";
import { getBlocksArray, insertBlockAt, removeBlockAt } from "@/features/collaboration/blocks";
import { BlockView } from "@/features/collaboration/BlockView";
import { usePublicCollaboration } from "@/features/collaboration/usePublicCollaboration";
import { useYjsObserve } from "@/features/collaboration/useYjsObserve";
import type { BlockType } from "@/features/collaboration/types";
import styles from "./PublicCollaborativeEditor.module.css";

const BLOCK_TYPES: { type: BlockType; label: string }[] = [
  { type: "paragraph", label: "Text" },
  { type: "heading", label: "Heading" },
  { type: "bulletListItem", label: "Bullet" },
  { type: "checkbox", label: "Checkbox" },
];

/**
 * The editable counterpart to `PublicDocumentView`, rendered instead of it
 * when a document is published with `publicAccessMode: 'edit'` (TT gap 2).
 * Reuses the same `BlockView` the authenticated editor uses (block
 * rendering/editing doesn't know or care whether the caller is
 * authenticated) on top of `usePublicCollaboration`'s anonymous, slug-
 * scoped session - the backend gateway guarantees this session can only
 * ever touch the one published document, never anything else.
 */
export function PublicCollaborativeEditor({ slug }: { slug: string }) {
  const { status, canEdit, error, ydoc } = usePublicCollaboration(slug);
  const blocks = useMemo(() => getBlocksArray(ydoc), [ydoc]);
  useYjsObserve(blocks);

  const handleAddBlock = useCallback(
    (type: BlockType) => {
      if (!canEdit) return;
      insertBlockAt(blocks, blocks.length, type);
    },
    [blocks, canEdit],
  );

  const handleRemove = useCallback(
    (index: number) => {
      if (!canEdit) return;
      removeBlockAt(blocks, index);
    },
    [blocks, canEdit],
  );

  if (status === "error") {
    return (
      <p className={styles.hint} role="alert">
        Couldn&apos;t connect to this document{error ? `: ${error}` : "."}
      </p>
    );
  }

  if (status === "connecting") {
    return (
      <div className={styles.loading}>
        <Spinner label="Connecting…" />
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.banner} role="status">
        You&apos;re editing a publicly shared document. Anyone with this link can make changes.
      </p>

      <div className={styles.blocks}>
        {blocks.length === 0 ? (
          <p className={styles.hint}>This document is empty. Add a block below to start writing.</p>
        ) : (
          blocks
            .toArray()
            .map((block, index) => (
              <BlockView
                key={block.get("id") as string}
                block={block}
                canEdit={canEdit}
                onRemove={() => handleRemove(index)}
              />
            ))
        )}
      </div>

      {canEdit ? (
        <div className={styles.addBlockRow}>
          {BLOCK_TYPES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              className={styles.addButton}
              onClick={() => handleAddBlock(type)}
            >
              + {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
