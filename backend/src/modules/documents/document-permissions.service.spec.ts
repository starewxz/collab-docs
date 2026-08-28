import { ForbiddenException } from '@nestjs/common';
import { DocumentPermissionsService } from './document-permissions.service';
import {
  DocumentAccessLevel,
  DocumentCollaborator,
} from './entities/document-collaborator.entity';
import { WorkspaceRole } from '../workspaces/workspace-role.enum';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';

interface FakeQueryBuilder {
  where: (sql: string, params: { restrictedIds: string[] }) => FakeQueryBuilder;
  andWhere: (sql: string, params: { userId: string }) => FakeQueryBuilder;
  getMany: () => Promise<DocumentCollaborator[]>;
}

function buildService(collaboratorRows: DocumentCollaborator[] = []) {
  const collaborators = {
    findOne: jest.fn(
      ({ where }: { where: { documentId: string; userId: string } }) =>
        Promise.resolve(
          collaboratorRows.find(
            (c) =>
              c.documentId === where.documentId && c.userId === where.userId,
          ) ?? null,
        ),
    ),
    find: jest.fn(({ where }: { where: { documentId: string } }) =>
      Promise.resolve(
        collaboratorRows.filter((c) => c.documentId === where.documentId),
      ),
    ),
    createQueryBuilder: jest.fn((): FakeQueryBuilder => {
      let restrictedIds: string[] = [];
      let userId = '';
      const builder: FakeQueryBuilder = {
        where: (_sql, params) => {
          restrictedIds = params.restrictedIds;
          return builder;
        },
        andWhere: (_sql, params) => {
          userId = params.userId;
          return builder;
        },
        getMany: () =>
          Promise.resolve(
            collaboratorRows.filter(
              (c) =>
                restrictedIds.includes(c.documentId) && c.userId === userId,
            ),
          ),
      };
      return builder;
    }),
    save: jest.fn((entity: Partial<DocumentCollaborator>) =>
      Promise.resolve({
        id: 'new-id',
        createdAt: new Date(),
        ...entity,
      } as DocumentCollaborator),
    ),
    create: jest.fn((entity: Partial<DocumentCollaborator>) => entity),
    delete: jest.fn(() => Promise.resolve()),
  };
  const members = {
    findOne: jest.fn(() => Promise.resolve({ id: 'member-1' })),
  };
  const service = new DocumentPermissionsService(
    collaborators as never,
    members as never,
    new WorkspacePermissionsService(),
  );
  return { service, collaborators, members };
}

function share(
  documentId: string,
  userId: string,
  accessLevel: DocumentAccessLevel,
): DocumentCollaborator {
  return {
    id: `${documentId}-${userId}`,
    documentId,
    userId,
    accessLevel,
    createdAt: new Date(),
  };
}

describe('DocumentPermissionsService', () => {
  describe('resolveAccess', () => {
    it('always grants OWNER/ADMIN full access, even on a restricted document', async () => {
      const { service } = buildService();
      const doc = { id: 'doc-1', restricted: true };

      await expect(
        service.resolveAccess(doc, 'user-owner', WorkspaceRole.OWNER),
      ).resolves.toEqual({ canView: true, canEdit: true });
      await expect(
        service.resolveAccess(doc, 'user-admin', WorkspaceRole.ADMIN),
      ).resolves.toEqual({ canView: true, canEdit: true });
    });

    it('falls back to workspace-role behavior when not restricted and no override exists', async () => {
      const { service } = buildService();
      const doc = { id: 'doc-1', restricted: false };

      await expect(
        service.resolveAccess(doc, 'editor-1', WorkspaceRole.EDITOR),
      ).resolves.toEqual({ canView: true, canEdit: true });
      await expect(
        service.resolveAccess(doc, 'viewer-1', WorkspaceRole.VIEWER),
      ).resolves.toEqual({ canView: true, canEdit: false });
    });

    it('denies a workspace EDITOR entirely on a restricted document with no share', async () => {
      const { service } = buildService();
      const doc = { id: 'doc-1', restricted: true };

      await expect(
        service.resolveAccess(doc, 'editor-1', WorkspaceRole.EDITOR),
      ).resolves.toEqual({ canView: false, canEdit: false });
    });

    it('restricts a workspace EDITOR to view-only via a VIEWER-level override', async () => {
      const rows = [share('doc-1', 'editor-1', DocumentAccessLevel.VIEWER)];
      const { service } = buildService(rows);
      const doc = { id: 'doc-1', restricted: true };

      await expect(
        service.resolveAccess(doc, 'editor-1', WorkspaceRole.EDITOR),
      ).resolves.toEqual({ canView: true, canEdit: false });
    });

    it('lets an explicitly-shared VIEWER read a restricted document', async () => {
      const rows = [share('doc-1', 'viewer-1', DocumentAccessLevel.VIEWER)];
      const { service } = buildService(rows);
      const doc = { id: 'doc-1', restricted: true };

      const access = await service.resolveAccess(
        doc,
        'viewer-1',
        WorkspaceRole.VIEWER,
      );
      expect(access.canView).toBe(true);
      expect(access.canEdit).toBe(false);
    });

    it('an EDITOR-level override can grant edit access on a restricted document', async () => {
      const rows = [share('doc-1', 'viewer-1', DocumentAccessLevel.EDITOR)];
      const { service } = buildService(rows);
      const doc = { id: 'doc-1', restricted: true };

      await expect(
        service.resolveAccess(doc, 'viewer-1', WorkspaceRole.VIEWER),
      ).resolves.toEqual({ canView: true, canEdit: true });
    });
  });

  describe('assertCanView / assertCanEdit', () => {
    it('throws ForbiddenException for a user without access', async () => {
      const { service } = buildService();
      const doc = { id: 'doc-1', restricted: true };

      await expect(
        service.assertCanView(doc, 'nobody', WorkspaceRole.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.assertCanEdit(doc, 'nobody', WorkspaceRole.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not throw for a user with access', async () => {
      const { service } = buildService();
      const doc = { id: 'doc-1', restricted: false };

      await expect(
        service.assertCanView(doc, 'editor-1', WorkspaceRole.EDITOR),
      ).resolves.toBeUndefined();
    });
  });

  describe('filterVisible', () => {
    it('hides restricted documents the user has no share on, keeps the rest', async () => {
      const rows = [
        share('doc-restricted', 'user-1', DocumentAccessLevel.VIEWER),
      ];
      const { service } = buildService(rows);
      const documents = [
        { id: 'doc-open', restricted: false },
        { id: 'doc-restricted', restricted: true },
        { id: 'doc-hidden', restricted: true },
      ];

      const visible = await service.filterVisible(
        documents,
        'user-1',
        WorkspaceRole.EDITOR,
      );
      expect(visible.map((d) => d.id).sort()).toEqual([
        'doc-open',
        'doc-restricted',
      ]);
    });

    it('returns everything for OWNER/ADMIN', async () => {
      const { service } = buildService();
      const documents = [
        { id: 'doc-open', restricted: false },
        { id: 'doc-restricted', restricted: true },
      ];

      const visible = await service.filterVisible(
        documents,
        'owner-1',
        WorkspaceRole.OWNER,
      );
      expect(visible).toEqual(documents);
    });
  });
});
