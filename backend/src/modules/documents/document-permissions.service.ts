import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspaceRole } from '../workspaces/workspace-role.enum';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';
import {
  DocumentAccessLevel,
  DocumentCollaborator,
} from './entities/document-collaborator.entity';

export interface DocumentAccess {
  canView: boolean;
  canEdit: boolean;
}

/** Just enough of `Document` for a resolution decision - callers that
 * already have a `DocumentResponseDto` (which carries `restricted`) don't
 * need to re-fetch the entity. */
export type AccessCheckedDocument = { id: string; restricted: boolean };

/**
 * Central resolver for "can this specific user do X to this specific
 * document" - layers a per-document `DocumentCollaborator` override on top
 * of the workspace-role bar `WorkspacePermissionsService.canEditDocument`
 * already establishes. Deliberately its own service (not folded into
 * `WorkspacePermissionsService`), same separation-of-concerns pattern as
 * `EntitlementsService` - workspace role and document-level ACL are
 * different axes that both have to pass independently.
 *
 * Resolution order:
 * 1. OWNER/ADMIN workspace roles always get full access - administrative
 *    override, matches the rest of the app's "OWNER/ADMIN can't be locked
 *    out" posture (e.g. member management, billing).
 * 2. An explicit `DocumentCollaborator` row for this user wins outright,
 *    in either direction: it can *grant* view access to an otherwise
 *    `restricted` document, or *restrict* a workspace EDITOR down to
 *    view-only (or, if simply absent, to nothing) on this one document.
 * 3. No row and the document is `restricted` - denied entirely.
 * 4. No row and the document is not `restricted` - falls back to the
 *    existing workspace-role behavior (every non-VIEWER member can edit,
 *    everyone can view) - so every pre-existing document is unaffected.
 */
@Injectable()
export class DocumentPermissionsService {
  constructor(
    @InjectRepository(DocumentCollaborator)
    private readonly collaborators: Repository<DocumentCollaborator>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    private readonly workspacePermissions: WorkspacePermissionsService,
  ) {}

  async resolveAccess(
    document: AccessCheckedDocument,
    userId: string,
    role: WorkspaceRole,
  ): Promise<DocumentAccess> {
    if (role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN) {
      return { canView: true, canEdit: true };
    }

    const override = await this.collaborators.findOne({
      where: { documentId: document.id, userId },
    });
    if (override) {
      return {
        canView: true,
        canEdit: override.accessLevel === DocumentAccessLevel.EDITOR,
      };
    }

    if (document.restricted) {
      return { canView: false, canEdit: false };
    }

    return {
      canView: true,
      canEdit: this.workspacePermissions.canEditDocument(role),
    };
  }

  async assertCanView(
    document: AccessCheckedDocument,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    const access = await this.resolveAccess(document, userId, role);
    if (!access.canView) {
      throw new ForbiddenException('You do not have access to this document');
    }
  }

  async assertCanEdit(
    document: AccessCheckedDocument,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    const access = await this.resolveAccess(document, userId, role);
    if (!access.canEdit) {
      throw new ForbiddenException('You cannot modify this document');
    }
  }

  /** Filters a list down to what this user may view - used by
   * list/search so a restricted document's title never leaks to a
   * workspace member who isn't explicitly shared on it. OWNER/ADMIN see
   * everything, matching `resolveAccess`. */
  async filterVisible<T extends AccessCheckedDocument>(
    documents: T[],
    userId: string,
    role: WorkspaceRole,
  ): Promise<T[]> {
    if (role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN) {
      return documents;
    }
    const restrictedIds = documents
      .filter((d) => d.restricted)
      .map((d) => d.id);
    if (restrictedIds.length === 0) {
      return documents;
    }
    const shares = await this.collaborators
      .createQueryBuilder('c')
      .where('c."documentId" IN (:...restrictedIds)', { restrictedIds })
      .andWhere('c."userId" = :userId', { userId })
      .getMany();
    const allowed = new Set(shares.map((s) => s.documentId));
    return documents.filter((d) => !d.restricted || allowed.has(d.id));
  }

  async listCollaborators(documentId: string): Promise<DocumentCollaborator[]> {
    return this.collaborators.find({ where: { documentId } });
  }

  /** OWNER/ADMIN-gated (see `WorkspacePermissionsService.canManageDocumentAccess`,
   * enforced by the controller) - upserts so re-sharing at a new level is a
   * single idempotent call, not "unshare then share". */
  async shareDocument(
    workspaceId: string,
    documentId: string,
    targetUserId: string,
    accessLevel: DocumentAccessLevel,
  ): Promise<DocumentCollaborator> {
    const targetMembership = await this.members.findOne({
      where: { workspaceId, userId: targetUserId },
    });
    if (!targetMembership) {
      throw new BadRequestException(
        'That user is not a member of this workspace',
      );
    }

    const existing = await this.collaborators.findOne({
      where: { documentId, userId: targetUserId },
    });
    if (existing) {
      existing.accessLevel = accessLevel;
      return this.collaborators.save(existing);
    }
    return this.collaborators.save(
      this.collaborators.create({
        documentId,
        userId: targetUserId,
        accessLevel,
      }),
    );
  }

  async unshareDocument(
    documentId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.collaborators.delete({ documentId, userId: targetUserId });
  }
}
