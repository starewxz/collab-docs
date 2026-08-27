import { ForbiddenException } from '@nestjs/common';
import { WorkspacePermissionsService } from './workspace-permissions.service';
import { WorkspaceRole } from './workspace-role.enum';

const { OWNER, ADMIN, EDITOR, VIEWER } = WorkspaceRole;

describe('WorkspacePermissionsService', () => {
  let permissions: WorkspacePermissionsService;

  beforeEach(() => {
    permissions = new WorkspacePermissionsService();
  });

  describe('canInviteMembers', () => {
    it('allows OWNER and ADMIN, denies EDITOR and VIEWER', () => {
      expect(permissions.canInviteMembers(OWNER)).toBe(true);
      expect(permissions.canInviteMembers(ADMIN)).toBe(true);
      expect(permissions.canInviteMembers(EDITOR)).toBe(false);
      expect(permissions.canInviteMembers(VIEWER)).toBe(false);
    });
  });

  describe('canChangeMemberRole (owner protection + role-change policy)', () => {
    it('never allows anyone to change the OWNER role', () => {
      expect(permissions.canChangeMemberRole(OWNER, OWNER, VIEWER)).toBe(false);
      expect(permissions.canChangeMemberRole(ADMIN, OWNER, VIEWER)).toBe(false);
    });

    it('never allows promotion to OWNER', () => {
      expect(permissions.canChangeMemberRole(OWNER, EDITOR, OWNER)).toBe(false);
      expect(permissions.canChangeMemberRole(ADMIN, EDITOR, OWNER)).toBe(false);
    });

    it('lets OWNER change any non-owner role', () => {
      expect(permissions.canChangeMemberRole(OWNER, ADMIN, VIEWER)).toBe(true);
      expect(permissions.canChangeMemberRole(OWNER, EDITOR, ADMIN)).toBe(true);
      expect(permissions.canChangeMemberRole(OWNER, VIEWER, EDITOR)).toBe(true);
    });

    it('lets ADMIN change EDITOR/VIEWER roles but not other ADMINs', () => {
      expect(permissions.canChangeMemberRole(ADMIN, EDITOR, VIEWER)).toBe(true);
      expect(permissions.canChangeMemberRole(ADMIN, VIEWER, EDITOR)).toBe(true);
      expect(permissions.canChangeMemberRole(ADMIN, ADMIN, VIEWER)).toBe(false);
    });

    it('never lets EDITOR or VIEWER change any role', () => {
      expect(permissions.canChangeMemberRole(EDITOR, VIEWER, ADMIN)).toBe(
        false,
      );
      expect(permissions.canChangeMemberRole(VIEWER, EDITOR, ADMIN)).toBe(
        false,
      );
    });
  });

  describe('canRemoveMember (owner protection)', () => {
    it('never allows removing the OWNER, even by another OWNER-equivalent actor', () => {
      expect(permissions.canRemoveMember(OWNER, OWNER)).toBe(false);
      expect(permissions.canRemoveMember(ADMIN, OWNER)).toBe(false);
    });

    it('lets OWNER remove anyone else', () => {
      expect(permissions.canRemoveMember(OWNER, ADMIN)).toBe(true);
      expect(permissions.canRemoveMember(OWNER, EDITOR)).toBe(true);
      expect(permissions.canRemoveMember(OWNER, VIEWER)).toBe(true);
    });

    it('lets ADMIN remove EDITOR/VIEWER but not other ADMINs', () => {
      expect(permissions.canRemoveMember(ADMIN, EDITOR)).toBe(true);
      expect(permissions.canRemoveMember(ADMIN, VIEWER)).toBe(true);
      expect(permissions.canRemoveMember(ADMIN, ADMIN)).toBe(false);
    });

    it('never lets EDITOR or VIEWER remove anyone', () => {
      expect(permissions.canRemoveMember(EDITOR, VIEWER)).toBe(false);
      expect(permissions.canRemoveMember(VIEWER, EDITOR)).toBe(false);
    });
  });

  describe('canLeaveWorkspace (owner cannot leave)', () => {
    it('denies OWNER, allows everyone else', () => {
      expect(permissions.canLeaveWorkspace(OWNER)).toBe(false);
      expect(permissions.canLeaveWorkspace(ADMIN)).toBe(true);
      expect(permissions.canLeaveWorkspace(EDITOR)).toBe(true);
      expect(permissions.canLeaveWorkspace(VIEWER)).toBe(true);
    });
  });

  describe('assert* helpers', () => {
    it('assertCanInviteMembers throws ForbiddenException when denied', () => {
      expect(() => permissions.assertCanInviteMembers(VIEWER)).toThrow(
        ForbiddenException,
      );
      expect(() => permissions.assertCanInviteMembers(ADMIN)).not.toThrow();
    });

    it('assertCanChangeMemberRole throws ForbiddenException when denied', () => {
      expect(() =>
        permissions.assertCanChangeMemberRole(ADMIN, OWNER, VIEWER),
      ).toThrow(ForbiddenException);
    });

    it('assertCanRemoveMember throws ForbiddenException when denied', () => {
      expect(() => permissions.assertCanRemoveMember(ADMIN, OWNER)).toThrow(
        ForbiddenException,
      );
    });
  });
});
