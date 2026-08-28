import { describe, expect, it, vi } from "vitest";
import {
  createDocument,
  listDocuments,
  moveDocument,
  publishDocument,
  unpublishDocument,
} from "./api";

describe("documents api", () => {
  it("listDocuments requests the flat workspace document list", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await listDocuments(apiFetch, "ws-1");

    expect(apiFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/documents");
  });

  it("listDocuments includes the includeArchived query param when requested", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await listDocuments(apiFetch, "ws-1", true);

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents?includeArchived=true",
    );
  });

  it("createDocument omits parentId when creating a root document", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "doc-1" });
    await createDocument(apiFetch, "ws-1", "Root");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Root" }),
      }),
    );
  });

  it("createDocument includes parentId when creating a child", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "doc-2" });
    await createDocument(apiFetch, "ws-1", "Child", "parent-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Child", parentId: "parent-1" }),
      }),
    );
  });

  it("moveDocument posts parentId, referenceId, and placement to the move endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "doc-1" });
    await moveDocument(apiFetch, "ws-1", "doc-1", null, "ref-1", "before");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/move",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ parentId: null, referenceId: "ref-1", placement: "before" }),
      }),
    );
  });

  it("publishDocument omits the body field when no slug is given", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "doc-1" });
    await publishDocument(apiFetch, "ws-1", "doc-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/publish",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );
  });

  it("publishDocument includes the slug when provided", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "doc-1" });
    await publishDocument(apiFetch, "ws-1", "doc-1", "custom-slug");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/publish",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ slug: "custom-slug" }),
      }),
    );
  });

  it("unpublishDocument posts to the unpublish endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "doc-1" });
    await unpublishDocument(apiFetch, "ws-1", "doc-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/unpublish",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
