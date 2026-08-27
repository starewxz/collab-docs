import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { WorkspaceInvitation } from './entities/workspace-invitation.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceRole } from './workspace-role.enum';

function buildInvitation(
  overrides: Partial<WorkspaceInvitation> = {},
): WorkspaceInvitation {
  return {
    id: 'invitation-1',
    workspaceId: 'workspace-1',
    email: 'bob@example.com',
    role: WorkspaceRole.VIEWER,
    tokenHash: 'hash',
    invitedById: 'user-owner',
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    rejectedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildService(invitation: WorkspaceInvitation | null) {
  const savedRows: unknown[] = [];
  const manager = {
    findOne: jest.fn().mockResolvedValue(invitation),
    save: jest.fn((entity: unknown) => {
      savedRows.push(entity);
      return Promise.resolve(entity);
    }),
    create: jest.fn((_entity: unknown, data: unknown) => data),
  };

  const dataSource = {
    transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(manager)),
  };

  const config = {
    app: { nodeEnv: 'test', frontendUrl: 'http://localhost:3000' },
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const metrics = { workspaceInvitationsTotal: { inc: jest.fn() } };

  const service = new InvitationsService(
    dataSource as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
    logger as never,
    metrics as never,
  );

  return { service, manager, savedRows };
}

describe('InvitationsService (expiration + email ownership)', () => {
  const currentUser = { sub: 'user-bob', email: 'bob@example.com' };

  it('accept() rejects an unknown token with 404', async () => {
    const { service } = buildService(null);
    await expect(service.accept('missing-token', currentUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('accept() rejects an expired invitation with 410 Gone', async () => {
    const invitation = buildInvitation({
      expiresAt: new Date(Date.now() - 1000),
    });
    const { service } = buildService(invitation);

    await expect(service.accept('token', currentUser)).rejects.toThrow(
      GoneException,
    );
  });

  it('accept() rejects when the authenticated email does not match the invitation', async () => {
    const invitation = buildInvitation({ email: 'someone-else@example.com' });
    const { service } = buildService(invitation);

    await expect(service.accept('token', currentUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('accept() rejects an already-accepted invitation', async () => {
    const invitation = buildInvitation({ acceptedAt: new Date() });
    const { service } = buildService(invitation);

    await expect(service.accept('token', currentUser)).rejects.toThrow(
      ConflictException,
    );
  });

  it('accept() rejects an already-rejected invitation', async () => {
    const invitation = buildInvitation({ rejectedAt: new Date() });
    const { service } = buildService(invitation);

    await expect(service.accept('token', currentUser)).rejects.toThrow(
      ConflictException,
    );
  });

  it('accept() creates a membership and marks the invitation accepted for a valid, matching invitation', async () => {
    const invitation = buildInvitation();
    const { service, manager } = buildService(invitation);
    manager.findOne
      .mockResolvedValueOnce(invitation) // the invitation lookup
      .mockResolvedValueOnce(null); // no existing membership

    const result = await service.accept('token', currentUser);

    expect(result).toEqual({ workspaceId: 'workspace-1' });
    const savedMember = manager.save.mock.calls.find(
      (call) => (call[0] as Partial<WorkspaceMember>).userId === 'user-bob',
    );
    expect(savedMember).toBeDefined();
    expect(invitation.acceptedAt).not.toBeNull();
  });

  it('reject() rejects an expired invitation with 410 Gone', async () => {
    const invitation = buildInvitation({
      expiresAt: new Date(Date.now() - 1000),
    });
    const { service } = buildService(invitation);

    await expect(service.reject('token', currentUser)).rejects.toThrow(
      GoneException,
    );
  });

  it('reject() rejects when the authenticated email does not match', async () => {
    const invitation = buildInvitation({ email: 'someone-else@example.com' });
    const { service } = buildService(invitation);

    await expect(service.reject('token', currentUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('reject() marks a valid invitation rejected', async () => {
    const invitation = buildInvitation();
    const { service } = buildService(invitation);

    await service.reject('token', currentUser);

    expect(invitation.rejectedAt).not.toBeNull();
  });
});
