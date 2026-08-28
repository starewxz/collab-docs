"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Button, EmptyState, IconButton, SlideOverPanel, Spinner, Tooltip, useToast } from "@/components/ui";
import { DownloadIcon, PaperclipIcon, TrashIcon } from "@/components/ui/icons";
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
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      showToast(`Uploaded "${file.name}"`);
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
    <SlideOverPanel title="Attachments" onClose={onClose}>
        {canEdit ? (
          <div className={styles.uploadArea}>
            <input
              ref={fileInputRef}
              type="file"
              className={styles.fileInput}
              onChange={handleFileSelected}
              disabled={uploading}
              aria-label="Choose a file to upload"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Upload a file"}
            </Button>
            {uploading ? <Spinner label="Uploading" /> : null}
            {uploadError ? (
              <p className={styles.error} role="alert">
                {uploadError}
              </p>
            ) : null}
          </div>
        ) : null}

        {actionError ? (
          <p className={styles.error} role="alert">
            {actionError}
          </p>
        ) : null}

        {attachments === null ? (
          <Spinner label="Loading attachments" />
        ) : loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : attachments.length === 0 ? (
          <EmptyState
            icon={<PaperclipIcon width={20} height={20} />}
            title="No attachments yet"
            description={canEdit ? "Upload a file above to attach it to this document." : "Nothing has been attached yet."}
            compact
          />
        ) : (
          <div className={styles.list}>
            {attachments.map((attachment) => (
              <div key={attachment.id} className={styles.row}>
                <PaperclipIcon className={styles.fileIcon} width={16} height={16} />
                <div className={styles.rowInfo}>
                  <span className={styles.filename}>{attachment.filename}</span>
                  <span className={styles.meta}>
                    {formatSize(attachment.size)}
                    {attachment.status === "pending" ? " · uploading…" : ""}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {attachment.status === "ready" ? (
                    <Tooltip label="Open">
                      <IconButton
                        size="sm"
                        aria-label={`Open "${attachment.filename}"`}
                        onClick={() => handleOpen(attachment)}
                      >
                        <DownloadIcon />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                  {canEdit ? (
                    <Tooltip label="Remove">
                      <IconButton
                        size="sm"
                        variant="danger"
                        aria-label={`Remove "${attachment.filename}"`}
                        onClick={() => handleRemove(attachment)}
                      >
                        <TrashIcon />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
    </SlideOverPanel>
  );
}
