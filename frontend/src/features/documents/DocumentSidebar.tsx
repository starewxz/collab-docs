"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRequireAuth } from "@/features/auth/useRequireAuth";
import { getWorkspace } from "@/features/workspaces/api";
import type { WorkspaceRole } from "@/features/workspaces/types";
import { isApiError, isPlanLimitError } from "@/lib/api-error";
import {
  archiveDocument,
  createDocument,
  listDocuments,
  moveDocument,
  renameDocument,
  restoreDocument,
} from "./api";
import styles from "./DocumentSidebar.module.css";
import { canCreateDocument, canEditDocument } from "./permissions";
import { DocumentTreeItem } from "./DocumentTreeItem";
import { buildDocumentTree } from "./tree";
import type { DocumentNode } from "./types";

export function DocumentSidebar({ workspaceId }: { workspaceId: string }) {
  const { status } = useRequireAuth();
  const { apiFetch } = useAuth();
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
  }

  async function handleCreateRoot() {
    setError(null);
    try {
      const doc = await createDocument(apiFetch, workspaceId, "Untitled");
      reload();
      select(doc.id);
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
    } catch (err) {
      setError(describeCreateError(err));
    }
  }

  /** On the FREE document limit, point to the billing section instead of a
   * generic failure - the backend is the sole authority on the limit, this
   * only makes the rejection actionable. */
  function describeCreateError(err: unknown): string {
    if (isPlanLimitError(err)) {
      return `${err.message} Upgrade to PRO from the workspace settings page.`;
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

  async function handleArchive(id: string) {
    setError(null);
    try {
      await archiveDocument(apiFetch, workspaceId, id);
      if (activeDocumentId === id) router.push(`/workspace/${workspaceId}`);
      reload();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to archive document.");
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

  const canEdit = role !== null && canEditDocument(role);
  const canCreate = role !== null && canCreateDocument(role);

  return (
    <nav className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Documents</span>
        {canCreate ? (
          <button
            type="button"
            className={styles.iconButton}
            title="New document"
            onClick={handleCreateRoot}
          >
            +
          </button>
        ) : null}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {documents === null ? (
        <p className={styles.hint}>Loading…</p>
      ) : tree.length === 0 ? (
        <p className={styles.hint}>
          {canCreate ? "No documents yet - create your first one." : "No documents yet."}
        </p>
      ) : (
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
              onArchive={handleArchive}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              isFirstSibling={index === 0}
              isLastSibling={index === tree.length - 1}
            />
          ))}
        </div>
      )}

      <div className={styles.archivedSection}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? "Hide archived" : `Archived (${archived.length})`}
        </button>
        {showArchived
          ? archived.map((doc) => (
              <div key={doc.id} className={styles.archivedRow}>
                <span className={styles.archivedTitle} title={doc.title}>
                  {doc.title}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Restore"
                    onClick={() => handleRestore(doc.id)}
                  >
                    ↺
                  </button>
                ) : null}
              </div>
            ))
          : null}
      </div>
    </nav>
  );
}
