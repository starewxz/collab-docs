"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { IconButton, Spinner, Tooltip } from "@/components/ui";
import {
  CheckIcon,
  CodeIcon,
  FileTextIcon,
  HeadingIcon,
  HistoryIcon,
  ImageIcon,
  ListIcon,
  MessageIcon,
  PaperclipIcon,
} from "@/components/ui/icons";
import { canComment as canCommentForRole } from "@/features/workspaces/permissions";
import type { WorkspaceRole } from "@/features/workspaces/types";
import { getBlocksArray, insertBlockAt, removeBlockAt } from "./blocks";
import { BlockView } from "./BlockView";
import styles from "./CollaborativeEditor.module.css";
import { PresenceBar } from "./PresenceBar";
import type { BlockType } from "./types";
import { useCollaboration } from "./useCollaboration";
import { useYjsObserve } from "./useYjsObserve";

/** These three panels are only ever needed after an explicit toolbar
 * click, never on first paint - loading them via next/dynamic keeps their
 * code out of the initial document-page bundle entirely. */
const VersionHistoryPanel = dynamic(
  () => import("./VersionHistoryPanel").then((m) => m.VersionHistoryPanel),
  { ssr: false },
);
const CommentsPanel = dynamic(
  () => import("@/features/comments/CommentsPanel").then((m) => m.CommentsPanel),
  { ssr: false },
);
const AttachmentsPanel = dynamic(
  () => import("@/features/attachments/AttachmentsPanel").then((m) => m.AttachmentsPanel),
  { ssr: false },
);

const BLOCK_TYPES: { type: BlockType; label: string; icon: typeof FileTextIcon }[] = [
  { type: "paragraph", label: "Text", icon: FileTextIcon },
  { type: "heading", label: "Heading", icon: HeadingIcon },
  { type: "bulletListItem", label: "Bullet", icon: ListIcon },
  { type: "checkbox", label: "Checkbox", icon: CheckIcon },
  { type: "codeBlock", label: "Code", icon: CodeIcon },
  { type: "image", label: "Image", icon: ImageIcon },
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
      <p className={styles.hint} role="alert">
        Couldn&apos;t connect to the collaboration session{error ? `: ${error}` : "."}
      </p>
    );
  }

  if (status === "connecting") {
    return (
      <div className={styles.loading}>
        <Spinner label="Connecting to document…" />
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <PresenceBar status={status} collaborators={collaborators} />
        <div className={styles.toolbarActions}>
          <Tooltip label="Comments">
            <IconButton aria-label="Open comments" onClick={() => setShowComments(true)}>
              <MessageIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="Files">
            <IconButton aria-label="Open attachments" onClick={() => setShowAttachments(true)}>
              <PaperclipIcon />
            </IconButton>
          </Tooltip>
          <Tooltip label="History">
            <IconButton aria-label="Open version history" onClick={() => setShowHistory(true)}>
              <HistoryIcon />
            </IconButton>
          </Tooltip>
        </div>
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
        <p className={styles.readOnlyBanner} role="status">
          <EyeIcon />
          {canComment
            ? "You have read-only access to this document — you can still comment."
            : "You have read-only access to this document."}
        </p>
      ) : null}

      <div className={styles.blocks}>
        {blocks.length === 0 ? (
          <p className={styles.hint}>
            {canEdit ? "This document is empty. Add a block below to start writing." : "This document is empty."}
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
          {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              type="button"
              className={styles.addButton}
              onClick={() => handleAddBlock(type)}
            >
              <Icon width={13} height={13} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}
