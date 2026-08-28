"use client";

import { useState } from "react";
import styles from "./DocumentSidebar.module.css";
import type { DocumentTreeNode } from "./tree";

export function DocumentTreeItem({
  node,
  depth,
  activeDocumentId,
  expanded,
  onToggleExpand,
  onSelect,
  canEdit,
  renamingId,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onAddChild,
  onArchive,
  onMoveUp,
  onMoveDown,
  isFirstSibling,
  isLastSibling,
}: {
  node: DocumentTreeNode;
  depth: number;
  activeDocumentId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  canEdit: boolean;
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onSubmitRename: (id: string, title: string) => void;
  onCancelRename: () => void;
  onAddChild: (parentId: string) => void;
  onArchive: (id: string) => void;
  onMoveUp: (node: DocumentTreeNode) => void;
  onMoveDown: (node: DocumentTreeNode) => void;
  isFirstSibling: boolean;
  isLastSibling: boolean;
}) {
  const [draftTitle, setDraftTitle] = useState(node.title);
  const isExpanded = expanded.has(node.id);
  const isRenaming = renamingId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`${styles.row} ${activeDocumentId === node.id ? styles.rowActive : ""}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}

        {isRenaming ? (
          <input
            className={styles.titleInput}
            autoFocus
            value={draftTitle}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmitRename(node.id, draftTitle);
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={() => onSubmitRename(node.id, draftTitle)}
          />
        ) : (
          <span className={styles.title} title={node.title}>
            {node.title}
          </span>
        )}

        {canEdit && !isRenaming ? (
          <span className={styles.rowActions}>
            {!isFirstSibling ? (
              <button
                type="button"
                className={styles.iconButton}
                title="Move up"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp(node);
                }}
              >
                ↑
              </button>
            ) : null}
            {!isLastSibling ? (
              <button
                type="button"
                className={styles.iconButton}
                title="Move down"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown(node);
                }}
              >
                ↓
              </button>
            ) : null}
            <button
              type="button"
              className={styles.iconButton}
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                setDraftTitle(node.title);
                onStartRename(node.id);
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className={styles.iconButton}
              title="Add child document"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild(node.id);
              }}
            >
              +
            </button>
            <button
              type="button"
              className={styles.iconButton}
              title="Archive"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(node.id);
              }}
            >
              🗑
            </button>
          </span>
        ) : null}
      </div>

      {isExpanded
        ? node.children.map((child, index) => (
            <DocumentTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeDocumentId={activeDocumentId}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              canEdit={canEdit}
              renamingId={renamingId}
              onStartRename={onStartRename}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onAddChild={onAddChild}
              onArchive={onArchive}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              isFirstSibling={index === 0}
              isLastSibling={index === node.children.length - 1}
            />
          ))
        : null}
    </div>
  );
}
