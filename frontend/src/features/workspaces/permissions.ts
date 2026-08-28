import type { WorkspaceRole } from "./types";

/**
 * UX-only mirror of the backend's WorkspacePermissionsService, used to
 * hide/disable controls a role clearly cannot use. The backend
 * independently re-checks every one of these on every request - this file
 * exists purely to avoid showing dead-end buttons.
 */
export function canInviteMembers(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canChangeMemberRole(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): boolean {
  if (targetRole === "OWNER") return false;
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return targetRole === "EDITOR" || targetRole === "VIEWER";
  return false;
}

export function canRemoveMember(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): boolean {
  return canChangeMemberRole(actorRole, targetRole);
}

export function canLeaveWorkspace(role: WorkspaceRole): boolean {
  return role !== "OWNER";
}

export function canComment(role: WorkspaceRole): boolean {
  return role !== "VIEWER";
}

export function canModerateComments(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export const ASSIGNABLE_ROLES: WorkspaceRole[] = ["ADMIN", "EDITOR", "VIEWER"];
