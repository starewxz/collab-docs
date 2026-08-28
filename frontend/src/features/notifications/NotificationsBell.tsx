"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { isApiError } from "@/lib/api-error";
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
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  async function handleMarkRead(notification: NotificationItem) {
    if (notification.readAt) return;
    try {
      await markNotificationRead(apiFetch, notification.id);
      setNotifications((prev) =>
        prev
          ? prev.map((n) =>
              n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n,
            )
          : prev,
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Non-critical UX action - silently ignore and let the next poll
      // reconcile the true unread state.
    }
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
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.bellButton}
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
      >
        🔔
        {unreadCount > 0 ? <span className={styles.badge}>{unreadCount}</span> : null}
      </button>

      {open ? (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <span className={styles.title}>Notifications</span>
            <button type="button" className={styles.linkButton} onClick={handleMarkAllRead}>
              Mark all read
            </button>
          </div>

          {notifications === null ? (
            <p className={styles.hint}>Loading…</p>
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : notifications.length === 0 ? (
            <p className={styles.hint}>You&apos;re all caught up.</p>
          ) : (
            <div className={styles.list}>
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className={`${styles.item} ${notification.readAt ? "" : styles.itemUnread}`}
                  onClick={() => handleMarkRead(notification)}
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
