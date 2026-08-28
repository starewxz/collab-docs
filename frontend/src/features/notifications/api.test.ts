import { describe, expect, it, vi } from "vitest";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "./api";

describe("notificationsApi", () => {
  it("listNotifications requests the notification list", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await listNotifications(apiFetch);

    expect(apiFetch).toHaveBeenCalledWith("/api/notifications");
  });

  it("listNotifications appends unreadOnly when requested", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await listNotifications(apiFetch, true);

    expect(apiFetch).toHaveBeenCalledWith("/api/notifications?unreadOnly=true");
  });

  it("unreadNotificationCount requests the unread count", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ count: 0 });
    await unreadNotificationCount(apiFetch);

    expect(apiFetch).toHaveBeenCalledWith("/api/notifications/unread-count");
  });

  it("markNotificationRead posts to the read endpoint for the given id", async () => {
    const apiFetch = vi.fn().mockResolvedValue(undefined);
    await markNotificationRead(apiFetch, "n1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/notifications/n1/read",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("markAllNotificationsRead posts to the read-all endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue(undefined);
    await markAllNotificationsRead(apiFetch);

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/notifications/read-all",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
