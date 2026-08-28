import { describe, expect, it, vi } from "vitest";
import { createVersion, inspectVersion, listVersions, restoreVersion } from "./versionsApi";

describe("versionsApi", () => {
  it("listVersions requests the versions list for a document", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await listVersions(apiFetch, "ws-1", "doc-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/versions",
    );
  });

  it("inspectVersion requests a specific version by id", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ blocks: [] });
    await inspectVersion(apiFetch, "ws-1", "doc-1", "v1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/versions/v1",
    );
  });

  it("createVersion omits the body field when no label is given", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "v1" });
    await createVersion(apiFetch, "ws-1", "doc-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/versions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );
  });

  it("createVersion includes the label when provided", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "v1" });
    await createVersion(apiFetch, "ws-1", "doc-1", "Before big change");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/versions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ label: "Before big change" }),
      }),
    );
  });

  it("restoreVersion posts to the restore endpoint for the given version", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ restoredFromVersionId: "v1" });
    await restoreVersion(apiFetch, "ws-1", "doc-1", "v1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/versions/v1/restore",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
