export type NotificationType = "mention" | "reply" | "thread_resolved" | "thread_reopened";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  /** Derived server-side from the notification's document, so the bell
   * can deep-link straight to the document (Stage 9). */
  workspaceId: string;
  documentId: string;
  commentId: string | null;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
