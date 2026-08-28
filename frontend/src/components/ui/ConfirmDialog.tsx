"use client";

import { useEffect, useRef } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

/** A small, reusable confirmation modal for destructive-ish actions
 * (archiving a document and its subtree) - not a full design-system
 * dialog, just enough to avoid an accidental click doing something hard
 * to notice went wrong. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onCancel);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <p className={styles.title}>{title}</p>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <Button
            variant={danger ? "primary" : "secondary"}
            className={danger ? styles.dangerButton : undefined}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
