import { describe, expect, it, vi } from "vitest";
import {
  acceptInvitationById,
  inviteMember,
  rejectInvitationById,
} from "./api";

describe("invitation actions", () => {
  it("inviteMember posts email + role to the workspace invitations endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "invite-1" });
    await inviteMember(apiFetch, "ws-1", "bob@example.com", "VIEWER");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/invitations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "bob@example.com", role: "VIEWER" }),
      }),
    );
  });

  it("acceptInvitationById posts to the by-id accept endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ workspaceId: "ws-1" });
    await acceptInvitationById(apiFetch, "invite-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/invitations/by-id/invite-1/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejectInvitationById posts to the by-id reject endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ success: true });
    await rejectInvitationById(apiFetch, "invite-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/invitations/by-id/invite-1/reject",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
