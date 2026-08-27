import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRole } from './workspace-role.enum';

/**
 * Single source of truth for "who can do what" inside a workspace. No
 * controller or service should compare `role === 'ADMIN'` directly -
 * everything routes through here so future modules (documents, comments,
 * billing) reuse the same rules instead of re-deriving them.
 *
 * Stage 2 policy: ownership is immutable. There is exactly one OWNER per
 * workspace, they can never be removed or demoted, and they can never
 * leave. Ownership transfer is deferred to a later stage.
 */
@Injectable()
export class WorkspacePermissionsService {
  canViewWorkspace(): boolean {
    // Reaching this point already implies membership was resolved, but the
    // method exists so callers have one consistent place to ask.
    return true;
  }

  canManageWorkspaceSettings(role: WorkspaceRole): boolean {
    return role === WorkspaceRole.OWNER;
  }

  canInviteMembers(role: WorkspaceRole): boolean {
    return role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN;
  }

  canViewInvitations(role: WorkspaceRole): boolean {
    return role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN;
  }

  canChangeMemberRole(
    actorRole: WorkspaceRole,
    targetRole: WorkspaceRole,
    newRole: WorkspaceRole,
  ): boolean {
    if (targetRole === WorkspaceRole.OWNER) {
      return false; // owner is immutable
    }
    if (newRole === WorkspaceRole.OWNER) {
      return false; // no promotion to owner via this endpoint
    }
    if (actorRole === WorkspaceRole.OWNER) {
      return true;
    }
    if (actorRole === WorkspaceRole.ADMIN) {
      // Admins may only touch editors/viewers, and only into
      // admin/editor/viewer - never each other.
      return (
        targetRole === WorkspaceRole.EDITOR ||
        targetRole === WorkspaceRole.VIEWER
      );
    }
    return false;
  }

  canRemoveMember(
    actorRole: WorkspaceRole,
    targetRole: WorkspaceRole,
  ): boolean {
    if (targetRole === WorkspaceRole.OWNER) {
      return false;
    }
    if (actorRole === WorkspaceRole.OWNER) {
      return true;
    }
    if (actorRole === WorkspaceRole.ADMIN) {
      return (
        targetRole === WorkspaceRole.EDITOR ||
        targetRole === WorkspaceRole.VIEWER
      );
    }
    return false;
  }

  canLeaveWorkspace(role: WorkspaceRole): boolean {
    return role !== WorkspaceRole.OWNER;
  }

  /** Future-ready only - no document module exists yet in Stage 2. */
  canCreateDocument(role: WorkspaceRole): boolean {
    return role !== WorkspaceRole.VIEWER;
  }

  /** Future-ready only - no document module exists yet in Stage 2. */
  canEditDocument(role: WorkspaceRole): boolean {
    return role !== WorkspaceRole.VIEWER;
  }

  assertCanInviteMembers(role: WorkspaceRole): void {
    if (!this.canInviteMembers(role)) {
      throw new ForbiddenException(
        'You cannot invite members to this workspace',
      );
    }
  }

  assertCanViewInvitations(role: WorkspaceRole): void {
    if (!this.canViewInvitations(role)) {
      throw new ForbiddenException(
        'You cannot view invitations for this workspace',
      );
    }
  }

  assertCanChangeMemberRole(
    actorRole: WorkspaceRole,
    targetRole: WorkspaceRole,
    newRole: WorkspaceRole,
  ): void {
    if (!this.canChangeMemberRole(actorRole, targetRole, newRole)) {
      throw new ForbiddenException("You cannot change this member's role");
    }
  }

  assertCanRemoveMember(
    actorRole: WorkspaceRole,
    targetRole: WorkspaceRole,
  ): void {
    if (!this.canRemoveMember(actorRole, targetRole)) {
      throw new ForbiddenException('You cannot remove this member');
    }
  }
}
