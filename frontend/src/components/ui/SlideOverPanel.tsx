"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import styles from "./SlideOverPanel.module.css";

/** Shared shell for every slide-over panel (Comments/Versions/Attachments)
 * - previously each panel duplicated its own overlay/header/close-button
 * markup with no focus trap and no dialog semantics. Fixing it once here
 * fixes it in all three. */
export function SlideOverPanel({
  title,
  onClose,
  width = 360,
  children,
}: {
  title: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onClose);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
          >
            ✕
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
