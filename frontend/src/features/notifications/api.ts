import type { NotificationItem } from "./types";

/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export function listNotifications(
  apiFetch: ApiFetch,
  unreadOnly = false,
): Promise<NotificationItem[]> {
  return apiFetch<NotificationItem[]>(
    `/api/notifications${unreadOnly ? "?unreadOnly=true" : ""}`,
  );
}

export function unreadNotificationCount(apiFetch: ApiFetch): Promise<{ count: number }> {
  return apiFetch<{ count: number }>("/api/notifications/unread-count");
}

export function markNotificationRead(
  apiFetch: ApiFetch,
  notificationId: string,
): Promise<void> {
  return apiFetch<void>(`/api/notifications/${notificationId}/read`, {
    method: "POST",
  });
}

export function markAllNotificationsRead(apiFetch: ApiFetch): Promise<void> {
  return apiFetch<void>("/api/notifications/read-all", { method: "POST" });
}
