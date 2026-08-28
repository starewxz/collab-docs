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
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentSearchResultDto } from './dto/document-search-result.dto';
import { MoveDocumentDto } from './dto/move-document.dto';
import { PublishDocumentDto } from './dto/publish-document.dto';
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
    @Query('includeArchived') includeArchived?: string,
  ): Promise<DocumentResponseDto[]> {
    return this.documentsService.list(workspaceId, includeArchived === 'true');
  }

  /** Registered before `:documentId` so "search" is matched as this route,
   * not as a document id - any member (including VIEWER) may search, same
   * bar as list/get. */
  @Get('search')
  async search(
    @Param('workspaceId') workspaceId: string,
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
      return await this.documentsService.search(
        workspaceId,
        q ?? '',
        limit,
        offset,
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
  ): Promise<DocumentResponseDto> {
    return this.documentsService.get(workspaceId, documentId);
  }

  @Patch(':documentId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.documentsService.update(workspaceId, documentId, dto);
  }

  @Post(':documentId/move')
  async move(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @Body() dto: MoveDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.documentsService.move(workspaceId, documentId, dto);
  }

  /** Archive (soft-delete) - never a hard delete through this API. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':documentId')
  async archive(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<void> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.documentsService.archive(workspaceId, documentId);
  }

  @Post(':documentId/restore')
  async restore(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.documentsService.restore(workspaceId, documentId);
  }

  /** Publishing reuses the same permission boundary as every other
   * document mutation (VIEWER read-only, everyone else can) - there is no
   * separate "sharing" permission tier, per Stage 7 scope. */
  @Post(':documentId/publish')
  async publish(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @Body() dto: PublishDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.documentsService.publish(workspaceId, documentId, dto);
  }

  @Post(':documentId/unpublish')
  async unpublish(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<DocumentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.documentsService.unpublish(workspaceId, documentId);
  }
}
