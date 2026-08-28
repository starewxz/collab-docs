import { describe, expect, it, vi } from "vitest";
import {
  createComment,
  deleteComment,
  listComments,
  reopenComment,
  resolveComment,
  updateComment,
} from "./api";

describe("commentsApi", () => {
  it("listComments requests the comment threads for a document", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await listComments(apiFetch, "ws-1", "doc-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/comments",
    );
  });

  it("createComment posts content and mentions", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "c1" });
    await createComment(apiFetch, "ws-1", "doc-1", {
      content: "Hello @a",
      mentionedUserIds: ["u1"],
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "Hello @a", mentionedUserIds: ["u1"] }),
      }),
    );
  });

  it("updateComment patches the comment by id", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "c1" });
    await updateComment(apiFetch, "ws-1", "doc-1", "c1", { content: "Edited" });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/comments/c1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ content: "Edited" }),
      }),
    );
  });

  it("deleteComment issues a DELETE request", async () => {
    const apiFetch = vi.fn().mockResolvedValue(undefined);
    await deleteComment(apiFetch, "ws-1", "doc-1", "c1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/comments/c1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("resolveComment posts to the resolve endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "c1" });
    await resolveComment(apiFetch, "ws-1", "doc-1", "c1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/comments/c1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reopenComment posts to the reopen endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "c1" });
    await reopenComment(apiFetch, "ws-1", "doc-1", "c1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/comments/c1/reopen",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
