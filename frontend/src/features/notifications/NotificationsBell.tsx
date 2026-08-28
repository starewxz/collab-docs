"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState, IconButton } from "@/components/ui";
import { BellIcon } from "@/components/ui/icons";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError } from "@/lib/api-error";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "./api";
import type { NotificationItem, NotificationType } from "./types";
import styles from "./NotificationsBell.module.css";

const POLL_INTERVAL_MS = 20_000;

const TYPE_LABEL: Record<NotificationType, string> = {
  mention: "mentioned you in a comment",
  reply: "replied to your comment",
  thread_resolved: "resolved a thread",
  thread_reopened: "reopened a thread",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function NotificationsBell() {
  const { apiFetch, status } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dropdownRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    function poll() {
      unreadNotificationCount(apiFetch)
        .then(({ count }) => {
          if (!cancelled) setUnreadCount(count);
        })
        .catch(() => undefined);
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiFetch, status]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listNotifications(apiFetch)
      .then((list) => {
        if (cancelled) return;
        setNotifications(list);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(isApiError(err) ? err.message : "Failed to load notifications.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, open]);

  /** Marking read is best-effort and never blocks navigation - a failed
   * mark-read just means the next poll reconciles the true unread state,
   * but the user's actual goal (go see what happened) still succeeds. */
  function handleOpenNotification(notification: NotificationItem) {
    setOpen(false);
    router.push(`/workspace/${notification.workspaceId}/document/${notification.documentId}`);
    if (notification.readAt) return;
    markNotificationRead(apiFetch, notification.id)
      .then(() => setUnreadCount((c) => Math.max(0, c - 1)))
      .catch(() => undefined);
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead(apiFetch);
      setNotifications((prev) =>
        prev ? prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) : prev,
      );
      setUnreadCount(0);
    } catch {
      // Same rationale as handleMarkRead above.
    }
  }

  if (status !== "authenticated") return null;

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <IconButton
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        active={open}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className={styles.badge}>{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
      </IconButton>

      {open ? (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          tabIndex={-1}
        >
          <div className={styles.header}>
            <span className={styles.title}>Notifications</span>
            {notifications && notifications.length > 0 ? (
              <button type="button" className={styles.linkButton} onClick={handleMarkAllRead}>
                Mark all read
              </button>
            ) : null}
          </div>

          {notifications === null ? (
            <p className={styles.hint}>Loading…</p>
          ) : error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<BellIcon width={20} height={20} />}
              title="You're all caught up"
              description="New mentions, replies, and thread updates will show up here."
              compact
            />
          ) : (
            <div className={styles.list}>
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className={`${styles.item} ${notification.readAt ? "" : styles.itemUnread}`}
                  onClick={() => handleOpenNotification(notification)}
                  aria-label={`${TYPE_LABEL[notification.type]}, open document`}
                >
                  <span className={styles.itemText}>{TYPE_LABEL[notification.type]}</span>
                  <span className={styles.itemMeta}>{formatTimestamp(notification.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
