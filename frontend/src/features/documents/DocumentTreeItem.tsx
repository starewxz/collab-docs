"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useState } from "react";
import { IconButton, Menu, MenuItem, Tooltip } from "@/components/ui";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "@/components/ui/icons";
import styles from "./DocumentSidebar.module.css";
import type { DropZone } from "./dragTypes";
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
  dragOverTarget,
  draggingId,
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
  dragOverTarget: { id: string; zone: DropZone } | null;
  draggingId: string | null;
}) {
  const [draftTitle, setDraftTitle] = useState(node.title);
  const isExpanded = expanded.has(node.id);
  const isRenaming = renamingId === node.id;
  const hasChildren = node.children.length > 0;
  const isActive = activeDocumentId === node.id;
  const isBeingDragged = draggingId === node.id;

  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: node.id,
    disabled: !canEdit || isRenaming,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: node.id,
    disabled: !canEdit,
  });
  const setRefs = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  const showIndicator = dragOverTarget?.id === node.id ? dragOverTarget.zone : null;

  return (
    <div>
      <div
        ref={setRefs}
        className={[
          styles.row,
          isActive ? styles.rowActive : "",
          isBeingDragged ? styles.rowDragging : "",
          showIndicator === "before" ? styles.dropBefore : "",
          showIndicator === "after" ? styles.dropAfter : "",
          showIndicator === "inside" ? styles.dropInside : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => onSelect(node.id)}
        {...attributes}
        {...listeners}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            aria-label={isExpanded ? `Collapse "${node.title}"` : `Expand "${node.title}"`}
          >
            <ChevronRightIcon
              style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
            />
          </button>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}

        <FileTextIcon className={styles.docIcon} width={14} height={14} />

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
          <span className={styles.rowActions} onClick={(e) => e.stopPropagation()}>
            <Tooltip label="Add child document">
              <IconButton
                size="sm"
                aria-label={`Add child document to "${node.title}"`}
                onClick={() => onAddChild(node.id)}
              >
                <PlusIcon />
              </IconButton>
            </Tooltip>
            <Menu
              trigger={({ onClick, ...triggerProps }) => (
                <IconButton
                  size="sm"
                  aria-label={`More actions for "${node.title}"`}
                  onClick={onClick}
                  {...triggerProps}
                >
                  <MoreHorizontalIcon />
                </IconButton>
              )}
            >
              <MenuItem
                onClick={() => {
                  setDraftTitle(node.title);
                  onStartRename(node.id);
                }}
              >
                <PencilIcon width={14} height={14} /> Rename
              </MenuItem>
              {!isFirstSibling ? (
                <MenuItem onClick={() => onMoveUp(node)}>
                  <ArrowUpIcon width={14} height={14} /> Move up
                </MenuItem>
              ) : null}
              {!isLastSibling ? (
                <MenuItem onClick={() => onMoveDown(node)}>
                  <ArrowDownIcon width={14} height={14} /> Move down
                </MenuItem>
              ) : null}
              <MenuItem danger onClick={() => onArchive(node.id)}>
                <ArchiveIcon width={14} height={14} /> Archive
              </MenuItem>
            </Menu>
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
              dragOverTarget={dragOverTarget}
              draggingId={draggingId}
            />
          ))
        : null}
    </div>
  );
}
