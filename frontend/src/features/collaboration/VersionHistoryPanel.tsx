"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError } from "@/lib/api-error";
import styles from "./VersionHistoryPanel.module.css";
import {
  createVersion,
  inspectVersion,
  listVersions,
  restoreVersion,
  type VersionDetail,
  type VersionSummary,
} from "./versionsApi";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function VersionHistoryPanel({
  workspaceId,
  documentId,
  canEdit,
  onClose,
  onRestored,
}: {
  workspaceId: string;
  documentId: string;
  canEdit: boolean;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const { apiFetch } = useAuth();

  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<VersionDetail | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listVersions(apiFetch, workspaceId, documentId)
      .then((list) => {
        if (cancelled) return;
        setVersions(list);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(isApiError(err) ? err.message : "Failed to load version history.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, workspaceId, documentId, reloadKey]);

  function reload() {
    setReloadKey((k) => k + 1);
    setSelected(null);
    setConfirmingRestore(false);
  }

  async function handleSelect(version: VersionSummary) {
    setInspectError(null);
    setConfirmingRestore(false);
    try {
      const detail = await inspectVersion(apiFetch, workspaceId, documentId, version.id);
      setSelected(detail);
    } catch (err) {
      setInspectError(isApiError(err) ? err.message : "Failed to load this version.");
    }
  }

  async function handleCreateVersion() {
    setCreating(true);
    setCreateError(null);
    try {
      await createVersion(apiFetch, workspaceId, documentId);
      reload();
    } catch (err) {
      setCreateError(isApiError(err) ? err.message : "Failed to save a snapshot.");
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmRestore() {
    if (!selected) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await restoreVersion(apiFetch, workspaceId, documentId, selected.id);
      onRestored?.();
      reload();
    } catch (err) {
      setRestoreError(isApiError(err) ? err.message : "Failed to restore this version.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Version History</span>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        {canEdit ? (
          <div>
            <Button variant="secondary" onClick={handleCreateVersion} disabled={creating}>
              {creating ? "Saving…" : "Save current as version"}
            </Button>
            {createError ? <p className={styles.error}>{createError}</p> : null}
          </div>
        ) : null}

        {versions === null ? (
          <Spinner label="Loading history" />
        ) : loadError ? (
          <p className={styles.error}>{loadError}</p>
        ) : versions.length === 0 ? (
          <p className={styles.hint}>
            No saved versions yet.{canEdit ? " Save one above to start tracking history." : ""}
          </p>
        ) : (
          <div className={styles.list}>
            {versions.map((version) => (
              <div
                key={version.id}
                className={`${styles.versionRow} ${selected?.id === version.id ? styles.versionRowSelected : ""}`}
                onClick={() => handleSelect(version)}
              >
                <span className={styles.versionLabel}>
                  {version.label ?? "Untitled snapshot"}
                  {version.kind === "restore-point" ? (
                    <span className={styles.badge}>auto</span>
                  ) : null}
                </span>
                <span className={styles.versionMeta}>
                  {formatTimestamp(version.createdAt)}
                  {version.authorName ? ` · ${version.authorName}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {inspectError ? <p className={styles.error}>{inspectError}</p> : null}

        {selected ? (
          <div className={styles.preview}>
            <span className={styles.title}>Preview</span>
            {selected.blocks.length === 0 ? (
              <p className={styles.hint}>This version is empty.</p>
            ) : (
              selected.blocks.map((block) => (
                <p key={block.id} className={styles.previewBlock}>
                  {block.type === "checkbox" ? (block.checked ? "☑ " : "☐ ") : ""}
                  {block.text ?? (block.type === "image" ? `[image: ${block.imageAlt}]` : "")}
                </p>
              ))
            )}

            {canEdit ? (
              confirmingRestore ? (
                <div className={styles.confirmBox}>
                  <span>
                    Restore to this version? Your current content will be saved as a new history
                    entry first, so nothing is lost.
                  </span>
                  {restoreError ? <p className={styles.error}>{restoreError}</p> : null}
                  <div className={styles.actions}>
                    <Button onClick={handleConfirmRestore} disabled={restoring}>
                      {restoring ? "Restoring…" : "Confirm restore"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmingRestore(false)}
                      disabled={restoring}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmingRestore(true)}>
                  Restore this version
                </Button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
