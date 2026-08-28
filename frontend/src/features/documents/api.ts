import type { DocumentNode, DocumentPlacement } from "./types";

/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export function listDocuments(
  apiFetch: ApiFetch,
  workspaceId: string,
  includeArchived = false,
): Promise<DocumentNode[]> {
  const query = includeArchived ? "?includeArchived=true" : "";
  return apiFetch<DocumentNode[]>(`/api/workspaces/${workspaceId}/documents${query}`);
}

export function getDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
): Promise<DocumentNode> {
  return apiFetch<DocumentNode>(`/api/workspaces/${workspaceId}/documents/${documentId}`);
}

export function createDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  title: string,
  parentId?: string,
): Promise<DocumentNode> {
  return apiFetch<DocumentNode>(`/api/workspaces/${workspaceId}/documents`, {
    method: "POST",
    body: JSON.stringify(parentId ? { title, parentId } : { title }),
  });
}

export function renameDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  title: string,
): Promise<DocumentNode> {
  return apiFetch<DocumentNode>(`/api/workspaces/${workspaceId}/documents/${documentId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function moveDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  parentId: string | null,
  referenceId?: string,
  placement?: DocumentPlacement,
): Promise<DocumentNode> {
  return apiFetch<DocumentNode>(`/api/workspaces/${workspaceId}/documents/${documentId}/move`, {
    method: "POST",
    body: JSON.stringify({ parentId, referenceId, placement }),
  });
}

export function archiveDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
): Promise<void> {
  return apiFetch<void>(`/api/workspaces/${workspaceId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

export function restoreDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
): Promise<DocumentNode> {
  return apiFetch<DocumentNode>(`/api/workspaces/${workspaceId}/documents/${documentId}/restore`, {
    method: "POST",
  });
}

export function publishDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  slug?: string,
): Promise<DocumentNode> {
  return apiFetch<DocumentNode>(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`, {
    method: "POST",
    body: JSON.stringify(slug ? { slug } : {}),
  });
}

export function unpublishDocument(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
): Promise<DocumentNode> {
  return apiFetch<DocumentNode>(`/api/workspaces/${workspaceId}/documents/${documentId}/unpublish`, {
    method: "POST",
  });
}
