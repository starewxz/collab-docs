import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { AttachmentsService } from './attachments.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import {
  AttachmentResponseDto,
  UploadUrlResponseDto,
} from './dto/attachment-response.dto';

@ApiBearerAuth()
@ApiTags('attachments')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces/:workspaceId/documents/:documentId/attachments')
export class AttachmentsController {
  constructor(
    private readonly attachmentsService: AttachmentsService,
    private readonly permissions: WorkspacePermissionsService,
  ) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<AttachmentResponseDto[]> {
    return this.attachmentsService.list(workspaceId, documentId);
  }

  @Post()
  async createUploadUrl(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAttachmentDto,
  ): Promise<UploadUrlResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.attachmentsService.createUploadUrl(
      workspaceId,
      documentId,
      user.sub,
      dto,
    );
  }

  @Post(':attachmentId/confirm')
  async confirm(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<AttachmentResponseDto> {
    this.permissions.assertCanEditDocument(membership.role);
    return this.attachmentsService.confirm(
      workspaceId,
      documentId,
      attachmentId,
    );
  }

  @Get(':attachmentId/download-url')
  async getDownloadUrl(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<{ url: string }> {
    return this.attachmentsService.getDownloadUrl(
      workspaceId,
      documentId,
      attachmentId,
    );
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':attachmentId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<void> {
    this.permissions.assertCanEditDocument(membership.role);
    await this.attachmentsService.remove(workspaceId, documentId, attachmentId);
  }
}
