import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { CurrentMembership } from '../workspaces/decorators/current-membership.decorator';
import type { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspaceMembershipGuard } from '../workspaces/guards/workspace-membership.guard';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';
import { CreateVersionDto } from './dto/create-version.dto';
import {
  RestoreResponseDto,
  VersionDetailResponseDto,
  VersionResponseDto,
} from './dto/version-response.dto';
import { VersionsService } from './versions.service';

/** Document version history - read access follows normal document read
 * access (any member); creating/restoring a version requires the same
 * edit permission as live collaborative editing. No second auth system. */
@ApiBearerAuth()
@ApiTags('document-versions')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces/:workspaceId/documents/:documentId/versions')
export class VersionsController {
  constructor(
    private readonly versionsService: VersionsService,
    private readonly permissions: WorkspacePermissionsService,
  ) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<VersionResponseDto[]> {
    return this.versionsService.list(workspaceId, documentId);
  }

  @Get(':versionId')
  async inspect(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
  ): Promise<VersionDetailResponseDto> {
    return this.versionsService.inspect(workspaceId, documentId, versionId);
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVersionDto,
  ): Promise<VersionResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.versionsService.create(
      workspaceId,
      documentId,
      user.sub,
      dto.label,
    );
  }

  @Post(':versionId/restore')
  async restore(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<RestoreResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.versionsService.restore(
      workspaceId,
      documentId,
      versionId,
      user.sub,
    );
  }
}
