/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface VersionSummary {
  id: string;
  documentId: string;
  kind: "manual" | "restore-point";
  createdById: string | null;
  authorName: string | null;
  label: string | null;
  createdAt: string;
}

export interface VersionBlock {
  id: string;
  type: string;
  text?: string;
  checked?: boolean;
  level?: number;
  language?: string;
  imageUrl?: string;
  imageAlt?: string;
}

export interface VersionDetail extends VersionSummary {
  blocks: VersionBlock[];
}

export interface RestoreResult {
  restoredFromVersionId: string;
  historyVersionId: string;
  restoredAt: string;
}

function basePath(workspaceId: string, documentId: string): string {
  return `/api/workspaces/${workspaceId}/documents/${documentId}/versions`;
}

export function listVersions(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
): Promise<VersionSummary[]> {
  return apiFetch<VersionSummary[]>(basePath(workspaceId, documentId));
}

export function inspectVersion(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  versionId: string,
): Promise<VersionDetail> {
  return apiFetch<VersionDetail>(`${basePath(workspaceId, documentId)}/${versionId}`);
}

export function createVersion(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  label?: string,
): Promise<VersionSummary> {
  return apiFetch<VersionSummary>(basePath(workspaceId, documentId), {
    method: "POST",
    body: JSON.stringify(label ? { label } : {}),
  });
}

export function restoreVersion(
  apiFetch: ApiFetch,
  workspaceId: string,
  documentId: string,
  versionId: string,
): Promise<RestoreResult> {
  return apiFetch<RestoreResult>(`${basePath(workspaceId, documentId)}/${versionId}/restore`, {
    method: "POST",
  });
}
