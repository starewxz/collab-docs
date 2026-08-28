"use client";

import { useState } from "react";
import { Badge, Button, IconButton, Select, Tooltip, useToast } from "@/components/ui";
import { CheckIcon, CopyIcon, GlobeIcon, LockIcon } from "@/components/ui/icons";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError } from "@/lib/api-error";
import { publishDocument, unpublishDocument } from "./api";
import type { DocumentNode, PublicAccessMode } from "./types";
import styles from "./PublishControl.module.css";

const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "Never", hours: null },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Minimal sharing UX - a single on/off state plus one URL, so this is a
 * small inline control rather than a slide-over panel like Comments/Files/
 * History (there's no list of items to browse). Publishing settings
 * (mode/expiry - TT gap 2) are chosen before publishing; changing them
 * once published means unpublishing and republishing, which keeps the
 * "one clear toggle" shape instead of a second edit-in-place flow. */
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
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<PublicAccessMode>("view");
  const [expiryHours, setExpiryHours] = useState<number | null>(null);

  const publicUrl =
    document.publicSlug && typeof window !== "undefined"
      ? `${window.location.origin}/p/${document.publicSlug}`
      : null;

  async function handlePublish() {
    setSubmitting(true);
    setError(null);
    try {
      const expiresAt = expiryHours
        ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()
        : undefined;
      const updated = await publishDocument(apiFetch, workspaceId, documentId, { mode, expiresAt });
      onChange(updated);
      showToast("Document published");
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
      showToast("Document unpublished");
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
      showToast("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission can be denied - non-critical, ignore.
    }
  }

  if (!document.isPublished && !editable) return null;

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        {document.isPublished && publicUrl ? (
          <>
            <Badge variant="accent">
              <GlobeIcon width={11} height={11} />
              Published{document.publicAccessMode === "edit" ? " · Editable by link" : ""}
            </Badge>
            {document.publicExpiresAt ? (
              <span className={styles.expiryNote}>Expires {formatExpiry(document.publicExpiresAt)}</span>
            ) : null}
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
              {publicUrl}
            </a>
            <Tooltip label={copied ? "Copied" : "Copy link"}>
              <IconButton size="sm" aria-label="Copy public link" onClick={handleCopy} disabled={submitting}>
                {copied ? <CheckIcon /> : <CopyIcon />}
              </IconButton>
            </Tooltip>
            {editable ? (
              <Button variant="ghost" size="sm" onClick={handleUnpublish} disabled={submitting}>
                {submitting ? "Unpublishing…" : "Unpublish"}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Badge variant="outline">
              <LockIcon width={11} height={11} /> Private
            </Badge>
            {editable ? (
              <>
                <Select
                  aria-label="Public link permission"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as PublicAccessMode)}
                  className={styles.modeSelect}
                >
                  <option value="view">Anyone with the link can view</option>
                  <option value="edit">Anyone with the link can edit</option>
                </Select>
                <Select
                  aria-label="Public link expiry"
                  value={String(expiryHours ?? "")}
                  onChange={(e) => setExpiryHours(e.target.value ? Number(e.target.value) : null)}
                  className={styles.modeSelect}
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.hours ?? ""}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" size="sm" onClick={handlePublish} disabled={submitting}>
                  {submitting ? "Publishing…" : "Publish"}
                </Button>
              </>
            ) : null}
          </>
        )}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
