import type { WorkspaceRole } from "@/features/workspaces/types";

/**
 * UX-only mirror of the backend's WorkspacePermissionsService document
 * rules, used to hide/disable controls a role clearly cannot use. The
 * backend independently re-checks every one of these on every request.
 */
export function canCreateDocument(role: WorkspaceRole): boolean {
  return role !== "VIEWER";
}

export function canEditDocument(role: WorkspaceRole): boolean {
  return role !== "VIEWER";
}
