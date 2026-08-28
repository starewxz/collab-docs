"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError } from "@/lib/api-error";
import { publishDocument, unpublishDocument } from "./api";
import type { DocumentNode } from "./types";
import styles from "./PublishControl.module.css";

/** Minimal sharing UX - a single on/off state plus one URL, so this is a
 * small inline control rather than a slide-over panel like Comments/Files/
 * History (there's no list of items to browse). */
export function PublishControl({
  workspaceId,
  documentId,
  document,
  editable,
  onChange,
}: {
  workspaceId: string;
  documentId: string;
  document: DocumentNode;
  editable: boolean;
  onChange: (updated: DocumentNode) => void;
}) {
  const { apiFetch } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const publicUrl =
    document.publicSlug && typeof window !== "undefined"
      ? `${window.location.origin}/p/${document.publicSlug}`
      : null;

  async function handlePublish() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await publishDocument(apiFetch, workspaceId, documentId);
      onChange(updated);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to publish document.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnpublish() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await unpublishDocument(apiFetch, workspaceId, documentId);
      onChange(updated);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to unpublish document.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission can be denied - non-critical, ignore.
    }
  }

  if (!document.isPublished && !editable) return null;

  return (
    <div className={styles.wrapper}>
      {document.isPublished && publicUrl ? (
        <>
          <span className={styles.badge}>Published</span>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            {publicUrl}
          </a>
          <Button variant="ghost" onClick={handleCopy} disabled={submitting}>
            {copied ? "Copied!" : "Copy link"}
          </Button>
          {editable ? (
            <Button variant="ghost" onClick={handleUnpublish} disabled={submitting}>
              {submitting ? "Unpublishing…" : "Unpublish"}
            </Button>
          ) : null}
        </>
      ) : (
        <Button variant="secondary" onClick={handlePublish} disabled={submitting}>
          {submitting ? "Publishing…" : "Publish"}
        </Button>
      )}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
