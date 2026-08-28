export type NotificationType = "mention" | "reply" | "thread_resolved" | "thread_reopened";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  documentId: string;
  commentId: string | null;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
