"use client";

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

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function PresenceBar({
  status,
  collaborators,
}: {
  status: CollabConnectionStatus;
  collaborators: PresenceUser[];
}) {
  return (
    <div className={styles.bar}>
      <span className={`${styles.statusDot} ${STATUS_CLASS[status]}`} title={STATUS_LABEL[status]} />
      <span>{STATUS_LABEL[status]}</span>
      {collaborators.length > 0 ? (
        <div className={styles.avatars}>
          {collaborators.map((user) => (
            <span
              key={user.id}
              className={styles.avatar}
              style={{ backgroundColor: user.color }}
              title={user.name}
            >
              {initials(user.name)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
