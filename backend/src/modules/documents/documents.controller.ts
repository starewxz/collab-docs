import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { CurrentMembership } from '../workspaces/decorators/current-membership.decorator';
import type { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspaceMembershipGuard } from '../workspaces/guards/workspace-membership.guard';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { DocumentPermissionsService } from './document-permissions.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentCollaboratorResponseDto } from './dto/document-collaborator-response.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentSearchResultDto } from './dto/document-search-result.dto';
import { MoveDocumentDto } from './dto/move-document.dto';
import { PublishDocumentDto } from './dto/publish-document.dto';
import { SetRestrictedDto } from './dto/set-restricted.dto';
import { ShareDocumentDto } from './dto/share-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentsService } from './documents.service';

const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;

@ApiBearerAuth()
@ApiTags('documents')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces/:workspaceId/documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly permissions: WorkspacePermissionsService,
    private readonly documentPermissions: DocumentPermissionsService,
    private readonly metrics: MetricsService,
  ) {}

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanCreateDocument(membership.role);
    return this.documentsService.create(workspaceId, user.sub, dto);
  }

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<DocumentResponseDto[]> {
    const documents = await this.documentsService.list(
      workspaceId,
      includeArchived === 'true',
    );
    return this.documentPermissions.filterVisible(
      documents,
      user.sub,
      membership.role,
    );
  }

  /** Registered before `:documentId` so "search" is matched as this route,
   * not as a document id - any member (including VIEWER) may search, same
   * bar as list/get. Results are still filtered through the same
   * document-level ACL as list() - a restricted document's title/snippet
   * must not leak through search either. */
  @Get('search')
  async search(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Query('q') q: string | undefined,
    @Query('limit') limitParam: string | undefined,
    @Query('offset') offsetParam: string | undefined,
  ): Promise<DocumentSearchResultDto[]> {
    const limit = Math.min(
      Math.max(parseInt(limitParam ?? '', 10) || DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );
    const offset = Math.max(parseInt(offsetParam ?? '', 10) || 0, 0);

    this.metrics.searchRequestsTotal.inc();
    try {
      const results = await this.documentsService.search(
        workspaceId,
        q ?? '',
        limit,
        offset,
      );
      const restricted = await this.documentsService.list(workspaceId, false);
      const restrictedIds = new Set(
        restricted.filter((d) => d.restricted).map((d) => d.id),
      );
      if (restrictedIds.size === 0) return results;
      const visible = await this.documentPermissions.filterVisible(
        restricted.filter((d) => restrictedIds.has(d.id)),
        user.sub,
        membership.role,
      );
      const visibleRestrictedIds = new Set(visible.map((d) => d.id));
      return results.filter(
        (r) => !restrictedIds.has(r.id) || visibleRestrictedIds.has(r.id),
      );
    } catch (err) {
      this.metrics.searchFailuresTotal.inc();
      throw err;
    }
  }

  @Get(':documentId')
  async getOne(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentResponseDto> {
    const document = await this.documentsService.get(workspaceId, documentId);
    await this.documentPermissions.assertCanView(
      document,
      user.sub,
      membership.role,
    );
    return document;
  }

  @Patch(':documentId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.assertDocumentEditable(
      workspaceId,
      documentId,
      user.sub,
      membership.role,
    );
    return this.documentsService.update(workspaceId, documentId, dto);
  }

  @Post(':documentId/move')
  async move(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: MoveDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.assertDocumentEditable(
      workspaceId,
      documentId,
      user.sub,
      membership.role,
    );
    return this.documentsService.move(workspaceId, documentId, dto);
  }

  /** Archive (soft-delete) - never a hard delete through this API. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':documentId')
  async archive(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.assertDocumentEditable(
      workspaceId,
      documentId,
      user.sub,
      membership.role,
    );
    await this.documentsService.archive(workspaceId, documentId);
  }

  @Post(':documentId/restore')
  async restore(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.assertDocumentEditable(
      workspaceId,
      documentId,
      user.sub,
      membership.role,
    );
    return this.documentsService.restore(workspaceId, documentId);
  }

  /** Publishing reuses the same permission boundary as every other
   * document mutation (VIEWER read-only, everyone else can, further
   * narrowed by the document-level ACL) - there is no separate "sharing"
   * permission tier, per Stage 7 scope. */
  @Post(':documentId/publish')
  async publish(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.assertDocumentEditable(
      workspaceId,
      documentId,
      user.sub,
      membership.role,
    );
    return this.documentsService.publish(workspaceId, documentId, dto);
  }

  @Post(':documentId/unpublish')
  async unpublish(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.assertDocumentEditable(
      workspaceId,
      documentId,
      user.sub,
      membership.role,
    );
    return this.documentsService.unpublish(workspaceId, documentId);
  }

  // --- Document-level ACL management (OWNER/ADMIN only) ---

  @Get(':documentId/collaborators')
  async listCollaborators(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentCollaboratorResponseDto[]> {
    const document = await this.documentsService.get(workspaceId, documentId);
    await this.documentPermissions.assertCanView(
      document,
      user.sub,
      membership.role,
    );
    const collaborators =
      await this.documentPermissions.listCollaborators(documentId);
    return collaborators.map((c) =>
      DocumentCollaboratorResponseDto.fromEntity(c),
    );
  }

  @Post(':documentId/collaborators')
  async shareDocument(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @Body() dto: ShareDocumentDto,
  ): Promise<DocumentCollaboratorResponseDto> {
    this.permissions.assertCanManageDocumentAccess(membership.role);
    // Confirms the document exists (and is in this workspace) before
    // creating a share row for it - same IDOR-safe scoped lookup as
    // every other document mutation.
    await this.documentsService.get(workspaceId, documentId);
    const collaborator = await this.documentPermissions.shareDocument(
      workspaceId,
      documentId,
      dto.userId,
      dto.accessLevel,
    );
    return DocumentCollaboratorResponseDto.fromEntity(collaborator);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':documentId/collaborators/:userId')
  async unshareDocument(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('userId') userId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<void> {
    this.permissions.assertCanManageDocumentAccess(membership.role);
    await this.documentsService.get(workspaceId, documentId);
    await this.documentPermissions.unshareDocument(documentId, userId);
  }

  @Patch(':documentId/access')
  async setRestricted(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @Body() dto: SetRestrictedDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanManageDocumentAccess(membership.role);
    return this.documentsService.setRestricted(
      workspaceId,
      documentId,
      dto.restricted,
    );
  }

  /** Shared by every mutation endpoint: the base workspace-role check
   * above (`assertCanEditDocument`) is necessary but not sufficient - the
   * document-level ACL (`DocumentPermissionsService`) can still restrict a
   * user who'd otherwise be allowed to edit. Re-fetches the document (a
   * second small query) rather than threading it through every service
   * method, so `DocumentsService`'s existing, already-tested methods stay
   * untouched. */
  private async assertDocumentEditable(
    workspaceId: string,
    documentId: string,
    userId: string,
    role: WorkspaceMember['role'],
  ): Promise<void> {
    const document = await this.documentsService.get(workspaceId, documentId);
    await this.documentPermissions.assertCanEdit(document, userId, role);
  }
}
