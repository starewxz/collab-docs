"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRequireAuth } from "@/features/auth/useRequireAuth";
import { getWorkspace } from "@/features/workspaces/api";
import type { WorkspaceRole } from "@/features/workspaces/types";
import { isApiError } from "@/lib/api-error";
import { CollaborativeEditor } from "@/features/collaboration/CollaborativeEditor";
import { getDocument, listDocuments, renameDocument, restoreDocument } from "./api";
import styles from "./DocumentPage.module.css";
import { canEditDocument } from "./permissions";
import { PublishControl } from "./PublishControl";
import type { DocumentNode } from "./types";

export function DocumentPage({
  workspaceId,
  documentId,
}: {
  workspaceId: string;
  documentId: string;
}) {
  const { status } = useRequireAuth();
  const { apiFetch } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [document, setDocument] = useState<DocumentNode | null>(null);
  const [allDocuments, setAllDocuments] = useState<DocumentNode[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    Promise.all([
      getWorkspace(apiFetch, workspaceId),
      getDocument(apiFetch, workspaceId, documentId),
      listDocuments(apiFetch, workspaceId, true),
    ])
      .then(([ws, doc, docs]) => {
        if (cancelled) return;
        setRole(ws.role);
        setDocument(doc);
        setTitleDraft(doc.title);
        setAllDocuments(docs);
        setNotFound(false);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(isApiError(err) ? err.message : "Failed to load document.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, apiFetch, workspaceId, documentId, reloadKey]);

  const breadcrumb = useMemo(() => {
    if (!document) return [];
    const byId = new Map(allDocuments.map((d) => [d.id, d]));
    const chain: DocumentNode[] = [];
    let current: DocumentNode | undefined = document;
    while (current?.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      chain.unshift(parent);
      current = parent;
    }
    return chain;
  }, [document, allDocuments]);

  async function handleTitleCommit() {
    const trimmed = titleDraft.trim();
    if (!document || !trimmed || trimmed === document.title) {
      setTitleDraft(document?.title ?? "");
      return;
    }
    setActionError(null);
    try {
      const updated = await renameDocument(apiFetch, workspaceId, documentId, trimmed);
      setDocument(updated);
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to rename document.");
      setTitleDraft(document.title);
    }
  }

  async function handleRestore() {
    setActionError(null);
    try {
      await restoreDocument(apiFetch, workspaceId, documentId);
      reload();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to restore document.");
    }
  }

  if (status === "loading" || (!document && !notFound && !loadError)) {
    return (
      <div className={styles.page}>
        <Spinner label="Loading document" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Document not found"
          description="It may have been deleted, or you may not have access to it."
        />
        <Button variant="ghost" onClick={() => router.push(`/workspace/${workspaceId}`)}>
          Back to workspace
        </Button>
      </div>
    );
  }

  if (loadError || !document) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>{loadError}</p>
      </div>
    );
  }

  const editable = role !== null && canEditDocument(role) && !document.archivedAt;

  return (
    <div className={styles.page}>
      {breadcrumb.length > 0 ? (
        <div className={styles.breadcrumb}>
          {breadcrumb.map((ancestor) => (
            <span key={ancestor.id}>
              <Link href={`/workspace/${workspaceId}/document/${ancestor.id}`}>
                {ancestor.title}
              </Link>
              {" / "}
            </span>
          ))}
          {document.title}
        </div>
      ) : null}

      {document.archivedAt ? (
        <div className={styles.archivedBanner}>
          <span>This document is archived.</span>
          {role !== null && canEditDocument(role) ? (
            <Button variant="secondary" onClick={handleRestore}>
              Restore
            </Button>
          ) : null}
        </div>
      ) : null}

      {actionError ? <p className={styles.error}>{actionError}</p> : null}

      <input
        className={styles.titleInput}
        value={titleDraft}
        disabled={!editable}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={handleTitleCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />

      <PublishControl
        workspaceId={workspaceId}
        documentId={documentId}
        document={document}
        editable={editable}
        onChange={setDocument}
      />

      <div className={styles.editorArea}>
        <CollaborativeEditor workspaceId={workspaceId} documentId={documentId} />
      </div>
    </div>
  );
}
