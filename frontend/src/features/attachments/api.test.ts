import { describe, expect, it, vi } from "vitest";
import {
  confirmAttachment,
  createUploadUrl,
  getAttachmentDownloadUrl,
  listAttachments,
  removeAttachment,
} from "./api";

describe("attachmentsApi", () => {
  it("listAttachments requests the attachment list for a document", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    await listAttachments(apiFetch, "ws-1", "doc-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/attachments",
    );
  });

  it("createUploadUrl posts the declared file metadata", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ attachment: {}, uploadUrl: "u" });
    await createUploadUrl(apiFetch, "ws-1", "doc-1", {
      filename: "a.txt",
      mimeType: "text/plain",
      size: 10,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/attachments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ filename: "a.txt", mimeType: "text/plain", size: 10 }),
      }),
    );
  });

  it("confirmAttachment posts to the confirm endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ id: "att-1" });
    await confirmAttachment(apiFetch, "ws-1", "doc-1", "att-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/attachments/att-1/confirm",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getAttachmentDownloadUrl requests the download-url endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ url: "u" });
    await getAttachmentDownloadUrl(apiFetch, "ws-1", "doc-1", "att-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/attachments/att-1/download-url",
    );
  });

  it("removeAttachment issues a DELETE request", async () => {
    const apiFetch = vi.fn().mockResolvedValue(undefined);
    await removeAttachment(apiFetch, "ws-1", "doc-1", "att-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/documents/doc-1/attachments/att-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
