import type { Attachment, UploadUrlResponse } from "./types";

/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

function basePath(workspaceId: string, documentId: string): string {
  return `/api/workspaces/${workspaceId}/documents/${documentId}/attachments`;
}

export function listAttachments(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
): Promise<Attachment[]> {
  return apiFetch<Attachment[]>(basePath(workspaceId, documentId));
}

export function createUploadUrl(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  input: { filename: string; mimeType: string; size: number },
): Promise<UploadUrlResponse> {
  return apiFetch<UploadUrlResponse>(basePath(workspaceId, documentId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmAttachment(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  attachmentId: string,
): Promise<Attachment> {
  return apiFetch<Attachment>(`${basePath(workspaceId, documentId)}/${attachmentId}/confirm`, {
    method: "POST",
  });
}

export function getAttachmentDownloadUrl(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  attachmentId: string,
): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(
    `${basePath(workspaceId, documentId)}/${attachmentId}/download-url`,
  );
}

export function removeAttachment(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  attachmentId: string,
): Promise<void> {
  return apiFetch<void>(`${basePath(workspaceId, documentId)}/${attachmentId}`, {
    method: "DELETE",
  });
}

/** Direct-to-storage upload: bytes go straight to the presigned MinIO URL,
 * never through our backend - this is a bare fetch, not `apiFetch`, since
 * the presigned URL carries its own auth and expects a raw PUT body. */
export function uploadFileToPresignedUrl(uploadUrl: string, file: File): Promise<Response> {
  return fetch(uploadUrl, { method: "PUT", body: file });
}
