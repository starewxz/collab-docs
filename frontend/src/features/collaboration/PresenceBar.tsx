"use client";

import { AvatarStack } from "@/components/ui";
import type { CollabConnectionStatus } from "./useCollaboration";
import type { PresenceUser } from "./types";
import styles from "./PresenceBar.module.css";

const STATUS_LABEL: Record<CollabConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  disconnected: "Reconnecting…",
  error: "Connection error",
};

const STATUS_CLASS: Record<CollabConnectionStatus, string> = {
  connecting: styles.statusConnecting,
  connected: styles.statusConnected,
  disconnected: styles.statusDisconnected,
  error: styles.statusError,
};

export function PresenceBar({
  status,
  collaborators,
}: {
  status: CollabConnectionStatus;
  collaborators: PresenceUser[];
}) {
  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <span
        className={`${styles.statusDot} ${STATUS_CLASS[status]}`}
        title={STATUS_LABEL[status]}
        aria-hidden="true"
      />
      <span className={styles.statusLabel}>{STATUS_LABEL[status]}</span>
      {collaborators.length > 0 ? (
        <AvatarStack
          people={collaborators.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
          max={5}
        />
      ) : null}
    </div>
  );
}
