import type { Comment, CommentThread } from "./types";

/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

function basePath(workspaceId: string, documentId: string): string {
  return `/api/workspaces/${workspaceId}/documents/${documentId}/comments`;
}

export function listComments(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
): Promise<CommentThread[]> {
  return apiFetch<CommentThread[]>(basePath(workspaceId, documentId));
}

export function createComment(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  input: { content: string; parentCommentId?: string; mentionedUserIds?: string[] },
): Promise<Comment> {
  return apiFetch<Comment>(basePath(workspaceId, documentId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateComment(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  commentId: string,
  input: { content: string; mentionedUserIds?: string[] },
): Promise<Comment> {
  return apiFetch<Comment>(`${basePath(workspaceId, documentId)}/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteComment(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  commentId: string,
): Promise<void> {
  return apiFetch<void>(`${basePath(workspaceId, documentId)}/${commentId}`, {
    method: "DELETE",
  });
}

export function resolveComment(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  commentId: string,
): Promise<Comment> {
  return apiFetch<Comment>(`${basePath(workspaceId, documentId)}/${commentId}/resolve`, {
    method: "POST",
  });
}

export function reopenComment(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  commentId: string,
): Promise<Comment> {
  return apiFetch<Comment>(`${basePath(workspaceId, documentId)}/${commentId}/reopen`, {
    method: "POST",
  });
}
