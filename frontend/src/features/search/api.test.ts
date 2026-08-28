import { describe, expect, it, vi } from "vitest";
import { searchDocuments } from "./api";

describe("searchDocuments", () => {
  it("GETs the workspace search endpoint with the query string", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await searchDocuments(apiFetch, "ws-1", "roadmap");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/search?q=roadmap",
    );
  });

  it("URL-encodes special characters in the query", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await searchDocuments(apiFetch, "ws-1", "a & b");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/search?q=a+%26+b",
    );
  });
});
