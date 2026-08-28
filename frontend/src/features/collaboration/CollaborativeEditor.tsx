"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { AttachmentsPanel } from "@/features/attachments/AttachmentsPanel";
import { CommentsPanel } from "@/features/comments/CommentsPanel";
import { canComment as canCommentForRole } from "@/features/workspaces/permissions";
import type { WorkspaceRole } from "@/features/workspaces/types";
import { getBlocksArray, insertBlockAt, removeBlockAt } from "./blocks";
import { BlockView } from "./BlockView";
import styles from "./CollaborativeEditor.module.css";
import { PresenceBar } from "./PresenceBar";
import type { BlockType } from "./types";
import { useCollaboration } from "./useCollaboration";
import { useYjsObserve } from "./useYjsObserve";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

const BLOCK_TYPES: { type: BlockType; label: string }[] = [
  { type: "paragraph", label: "Text" },
  { type: "heading", label: "Heading" },
  { type: "bulletListItem", label: "Bullet" },
  { type: "checkbox", label: "Checkbox" },
  { type: "codeBlock", label: "Code" },
  { type: "image", label: "Image" },
];

export function CollaborativeEditor({
  workspaceId,
  documentId,
}: {
  workspaceId: string;
  documentId: string;
}) {
  const { status, canEdit, collaborators, ydoc, error, role } = useCollaboration(
    workspaceId,
    documentId,
  );
  const blocks = useMemo(() => getBlocksArray(ydoc), [ydoc]);
  useYjsObserve(blocks);
  const [showHistory, setShowHistory] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const canComment = role ? canCommentForRole(role as WorkspaceRole) : false;

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
      <p className={styles.hint}>
        Couldn&apos;t connect to the collaboration session{error ? `: ${error}` : "."}
      </p>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <PresenceBar status={status} collaborators={collaborators} />
        <Button variant="ghost" onClick={() => setShowComments(true)}>
          Comments
        </Button>
        <Button variant="ghost" onClick={() => setShowAttachments(true)}>
          Files
        </Button>
        <Button variant="ghost" onClick={() => setShowHistory(true)}>
          History
        </Button>
      </div>

      {showHistory ? (
        <VersionHistoryPanel
          workspaceId={workspaceId}
          documentId={documentId}
          canEdit={canEdit}
          onClose={() => setShowHistory(false)}
        />
      ) : null}

      {showComments ? (
        <CommentsPanel
          workspaceId={workspaceId}
          documentId={documentId}
          canComment={canComment}
          role={role}
          onClose={() => setShowComments(false)}
        />
      ) : null}

      {showAttachments ? (
        <AttachmentsPanel
          workspaceId={workspaceId}
          documentId={documentId}
          canEdit={canEdit}
          onClose={() => setShowAttachments(false)}
        />
      ) : null}

      {!canEdit ? (
        <p className={styles.readOnlyBanner}>You have read-only access to this document.</p>
      ) : null}

      <div className={styles.blocks}>
        {blocks.length === 0 ? (
          <p className={styles.hint}>
            {canEdit ? "Add your first block below." : "This document is empty."}
          </p>
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
