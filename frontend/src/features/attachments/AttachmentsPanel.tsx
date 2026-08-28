"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError } from "@/lib/api-error";
import {
  confirmAttachment,
  createUploadUrl,
  getAttachmentDownloadUrl,
  listAttachments,
  removeAttachment,
  uploadFileToPresignedUrl,
} from "./api";
import type { Attachment } from "./types";
import styles from "./AttachmentsPanel.module.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  workspaceId,
  documentId,
  canEdit,
  onClose,
}: {
  workspaceId: string;
  documentId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { apiFetch } = useAuth();

  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAttachments(apiFetch, workspaceId, documentId)
      .then((list) => {
        if (cancelled) return;
        setAttachments(list);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(isApiError(err) ? err.message : "Failed to load attachments.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, workspaceId, documentId, reloadKey]);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const { attachment, uploadUrl } = await createUploadUrl(apiFetch, workspaceId, documentId, {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      });
      const putRes = await uploadFileToPresignedUrl(uploadUrl, file);
      if (!putRes.ok) {
        throw new Error("Upload to storage failed");
      }
      await confirmAttachment(apiFetch, workspaceId, documentId, attachment.id);
      reload();
    } catch (err) {
      setUploadError(isApiError(err) ? err.message : "Failed to upload file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleOpen(attachment: Attachment) {
    setActionError(null);
    try {
      const { url } = await getAttachmentDownloadUrl(
        apiFetch,
        workspaceId,
        documentId,
        attachment.id,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to open attachment.");
    }
  }

  async function handleRemove(attachment: Attachment) {
    setActionError(null);
    try {
      await removeAttachment(apiFetch, workspaceId, documentId, attachment.id);
      reload();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to remove attachment.");
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Attachments</span>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        {canEdit ? (
          <div>
            <input
              type="file"
              className={styles.fileInput}
              onChange={handleFileSelected}
              disabled={uploading}
            />
            {uploading ? <Spinner label="Uploading" /> : null}
            {uploadError ? <p className={styles.error}>{uploadError}</p> : null}
          </div>
        ) : null}

        {actionError ? <p className={styles.error}>{actionError}</p> : null}

        {attachments === null ? (
          <Spinner label="Loading attachments" />
        ) : loadError ? (
          <p className={styles.error}>{loadError}</p>
        ) : attachments.length === 0 ? (
          <p className={styles.hint}>No attachments yet.</p>
        ) : (
          <div className={styles.list}>
            {attachments.map((attachment) => (
              <div key={attachment.id} className={styles.row}>
                <div className={styles.rowInfo}>
                  <span className={styles.filename}>{attachment.filename}</span>
                  <span className={styles.meta}>
                    {formatSize(attachment.size)}
                    {attachment.status === "pending" ? " · uploading…" : ""}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {attachment.status === "ready" ? (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => handleOpen(attachment)}
                    >
                      Open
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => handleRemove(attachment)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
