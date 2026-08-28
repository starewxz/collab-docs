"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, IconButton, Tooltip, useToast } from "@/components/ui";
import { ChevronRightIcon, FileTextIcon, PlusIcon, UndoIcon } from "@/components/ui/icons";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRequireAuth } from "@/features/auth/useRequireAuth";
import { getWorkspace } from "@/features/workspaces/api";
import type { WorkspaceRole } from "@/features/workspaces/types";
import { formatPlanLimitMessage, isApiError, isPlanLimitError } from "@/lib/api-error";
import {
  archiveDocument,
  createDocument,
  listDocuments,
  moveDocument,
  renameDocument,
  restoreDocument,
} from "./api";
import { computeOptimisticMove, isSelfOrDescendant, resolveDropZone } from "./dragMove";
import { ROOT_DROP_ZONE_ID, type DropZone } from "./dragTypes";
import styles from "./DocumentSidebar.module.css";
import { canCreateDocument, canEditDocument } from "./permissions";
import { DocumentTreeItem } from "./DocumentTreeItem";
import { buildDocumentTree } from "./tree";
import type { DocumentNode, DocumentPlacement } from "./types";

export function DocumentSidebar({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  /** Called after navigating to a document - lets a mobile drawer wrapper
   * close itself once the user has actually picked something, without
   * DocumentSidebar needing to know it might be inside a drawer. */
  onNavigate?: () => void;
}) {
  const { status } = useRequireAuth();
  const { apiFetch } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const activeDocumentId = useMemo(() => {
    const match = pathname.match(/\/document\/([^/]+)/);
    return match ? match[1] : null;
  }, [pathname]);

  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [documents, setDocuments] = useState<DocumentNode[] | null>(null);
  const [archived, setArchived] = useState<DocumentNode[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; title: string } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ id: string; zone: DropZone } | null>(
    null,
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    Promise.all([
      getWorkspace(apiFetch, workspaceId),
      listDocuments(apiFetch, workspaceId, true),
    ])
      .then(([ws, docs]) => {
        if (cancelled) return;
        setRole(ws.role);
        setDocuments(docs.filter((d) => !d.archivedAt));
        setArchived(docs.filter((d) => d.archivedAt));
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(isApiError(err) ? err.message : "Failed to load documents.");
      });
    return () => {
      cancelled = true;
    };
  }, [status, apiFetch, workspaceId, reloadKey]);

  const tree = useMemo(() => buildDocumentTree(documents ?? []), [documents]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function select(id: string) {
    router.push(`/workspace/${workspaceId}/document/${id}`);
    onNavigate?.();
  }

  async function handleCreateRoot() {
    setError(null);
    try {
      const doc = await createDocument(apiFetch, workspaceId, "Untitled");
      reload();
      select(doc.id);
      showToast("Document created");
    } catch (err) {
      setError(describeCreateError(err));
    }
  }

  async function handleAddChild(parentId: string) {
    setError(null);
    try {
      const doc = await createDocument(apiFetch, workspaceId, "Untitled", parentId);
      setExpanded((prev) => new Set(prev).add(parentId));
      reload();
      select(doc.id);
      showToast("Document created");
    } catch (err) {
      setError(describeCreateError(err));
    }
  }

  /** On the FREE document limit, point to the billing section instead of a
   * generic failure - the backend is the sole authority on the limit, this
   * only makes the rejection actionable. */
  function describeCreateError(err: unknown): string {
    if (isPlanLimitError(err)) {
      return formatPlanLimitMessage(err, "Upgrade to PRO from the workspace settings page.");
    }
    return isApiError(err) ? err.message : "Failed to create document.";
  }

  async function handleSubmitRename(id: string, title: string) {
    setRenamingId(null);
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await renameDocument(apiFetch, workspaceId, id, trimmed);
      reload();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to rename document.");
    }
  }

  /** Archiving a document takes its entire subtree with it - easy to do
   * by accident from a hover control, so it's confirmed rather than
   * immediate (still fully reversible via restore, but not obviously so
   * at a glance). */
  function requestArchive(id: string) {
    const doc = (documents ?? []).find((d) => d.id === id);
    setArchiveTarget({ id, title: doc?.title || "Untitled" });
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    const id = archiveTarget.id;
    setError(null);
    setArchiving(true);
    try {
      await archiveDocument(apiFetch, workspaceId, id);
      if (activeDocumentId === id) router.push(`/workspace/${workspaceId}`);
      reload();
      setArchiveTarget(null);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to archive document.");
      setArchiveTarget(null);
    } finally {
      setArchiving(false);
    }
  }

  async function handleRestore(id: string) {
    setError(null);
    try {
      await restoreDocument(apiFetch, workspaceId, id);
      reload();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to restore document.");
    }
  }

  function siblingsOf(parentId: string | null): DocumentNode[] {
    return (documents ?? [])
      .filter((d) => d.parentId === parentId)
      .sort((a, b) => a.position - b.position);
  }

  async function handleMoveUp(node: { id: string; parentId: string | null }) {
    const siblings = siblingsOf(node.parentId);
    const index = siblings.findIndex((s) => s.id === node.id);
    const prev = siblings[index - 1];
    if (!prev) return;
    setError(null);
    try {
      await moveDocument(apiFetch, workspaceId, node.id, node.parentId, prev.id, "before");
      reload();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to reorder document.");
    }
  }

  async function handleMoveDown(node: { id: string; parentId: string | null }) {
    const siblings = siblingsOf(node.parentId);
    const index = siblings.findIndex((s) => s.id === node.id);
    const next = siblings[index + 1];
    if (!next) return;
    setError(null);
    try {
      await moveDocument(apiFetch, workspaceId, node.id, node.parentId, next.id, "after");
      reload();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to reorder document.");
    }
  }

  /** Called continuously while dragging (dnd-kit re-fires on every frame
   * the pointer moves over a droppable) - just tracks which row/zone to
   * highlight, no data mutation happens here. */
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    // A row is both draggable and droppable, so early in a drag (before
    // the pointer has left the source row) `over` can briefly be the row
    // being dragged itself - don't show a drop indicator on top of the
    // item you're picking up.
    if (!over || over.id === active.id) {
      setDragOverTarget(null);
      return;
    }
    if (over.id === ROOT_DROP_ZONE_ID) {
      setDragOverTarget({ id: ROOT_DROP_ZONE_ID, zone: "inside" });
      return;
    }
    const activeRect = active.rect.current.translated;
    if (!activeRect) return;
    const zone = resolveDropZone(
      activeRect.top,
      activeRect.height,
      over.rect.top,
      over.rect.height,
    );
    setDragOverTarget({ id: String(over.id), zone });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const target = dragOverTarget;
    setDraggingId(null);
    setDragOverTarget(null);
    if (!documents || !target) return;

    const nodeId = String(event.active.id);
    const resolved = resolveDragEndMove(documents, nodeId, target);
    if (!resolved) return;

    const previous = documents;
    setDocuments(
      computeOptimisticMove(previous, nodeId, resolved.parentId, resolved.referenceId, resolved.placement),
    );
    setError(null);
    try {
      await moveDocument(
        apiFetch,
        workspaceId,
        nodeId,
        resolved.parentId,
        resolved.referenceId,
        resolved.placement,
      );
      reload();
    } catch (err) {
      setDocuments(previous);
      setError(isApiError(err) ? err.message : "Failed to move document.");
    }
  }

  const canEdit = role !== null && canEditDocument(role);
  const canCreate = role !== null && canCreateDocument(role);
  const draggingNode = draggingId ? (documents ?? []).find((d) => d.id === draggingId) : null;

  return (
    <nav className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Documents</span>
        {canCreate ? (
          <Tooltip label="New document">
            <IconButton size="sm" aria-label="Create root document" onClick={handleCreateRoot}>
              <PlusIcon />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {documents === null ? (
        <p className={styles.hint}>Loading…</p>
      ) : tree.length === 0 ? (
        <p className={styles.hint}>
          {canCreate ? "No documents yet - create your first one." : "No documents yet."}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) => setDraggingId(String(event.active.id))}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setDraggingId(null);
            setDragOverTarget(null);
          }}
        >
          <div className={styles.tree}>
            {tree.map((node, index) => (
              <DocumentTreeItem
                key={node.id}
                node={node}
                depth={0}
                activeDocumentId={activeDocumentId}
                expanded={expanded}
                onToggleExpand={toggleExpand}
                onSelect={select}
                canEdit={canEdit}
                renamingId={renamingId}
                onStartRename={setRenamingId}
                onSubmitRename={handleSubmitRename}
                onCancelRename={() => setRenamingId(null)}
                onAddChild={handleAddChild}
                onArchive={requestArchive}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                isFirstSibling={index === 0}
                isLastSibling={index === tree.length - 1}
                dragOverTarget={dragOverTarget}
                draggingId={draggingId}
              />
            ))}
          </div>
          {canEdit && draggingId ? (
            <RootDropZone isOver={dragOverTarget?.id === ROOT_DROP_ZONE_ID} />
          ) : null}
          <DragOverlay dropAnimation={null}>
            {draggingNode ? (
              <div className={styles.dragOverlayRow}>
                <FileTextIcon className={styles.docIcon} width={14} height={14} />
                <span className={styles.title}>{draggingNode.title}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className={styles.archivedSection}>
        <button
          type="button"
          className={styles.archivedToggle}
          onClick={() => setShowArchived((v) => !v)}
          aria-expanded={showArchived}
          aria-controls="archived-documents-list"
        >
          <ChevronRightIcon
            style={{ transform: showArchived ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
          />
          {showArchived ? "Archived" : `Archived (${archived.length})`}
        </button>
        {showArchived ? (
          <div id="archived-documents-list" className={styles.archivedList}>
            {archived.length === 0 ? (
              <p className={styles.hint}>No archived documents.</p>
            ) : (
              archived.map((doc) => (
                <div key={doc.id} className={styles.archivedRow}>
                  <span className={styles.archivedTitle} title={doc.title}>
                    {doc.title}
                  </span>
                  {canEdit ? (
                    <Tooltip label="Restore">
                      <IconButton
                        size="sm"
                        aria-label={`Restore "${doc.title}"`}
                        onClick={() => handleRestore(doc.id)}
                      >
                        <UndoIcon />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {archiveTarget ? (
        <ConfirmDialog
          title="Archive document?"
          message={`"${archiveTarget.title}" and any nested documents will be moved to Archived. You can restore them later from the sidebar.`}
          confirmLabel="Archive"
          danger
          pending={archiving}
          onConfirm={confirmArchive}
          onCancel={() => setArchiveTarget(null)}
        />
      ) : null}
    </nav>
  );
}

/** Always-present drop target for "move this document to the workspace
 * root" - only rendered while a drag is in progress (see DocumentSidebar),
 * since it has no other purpose. */
function RootDropZone({ isOver }: { isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: ROOT_DROP_ZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={`${styles.rootDropZone} ${isOver ? styles.rootDropZoneActive : ""}`}
    >
      Drop here to move to root
    </div>
  );
}
