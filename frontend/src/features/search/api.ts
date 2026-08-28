import type { DocumentSearchResult } from "./types";

/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export function searchDocuments(
  apiFetch: ApiFetch,
  workspaceId: string,
  query: string,
): Promise<DocumentSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  return apiFetch<DocumentSearchResult[]>(
    `/api/workspaces/${workspaceId}/documents/search?${params.toString()}`,
  );
}
