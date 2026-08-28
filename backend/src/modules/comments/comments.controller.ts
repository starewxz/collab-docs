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
import { CommentsService } from './comments.service';
import {
  CommentResponseDto,
  CommentThreadResponseDto,
} from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

/** VIEWER may read comments (canComment gates every mutation below);
 * ownership/moderation for edit/delete is enforced in CommentsService,
 * where the target comment's actual author is known. */
@ApiBearerAuth()
@ApiTags('comments')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces/:workspaceId/documents/:documentId/comments')
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly permissions: WorkspacePermissionsService,
  ) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<CommentThreadResponseDto[]> {
    return this.commentsService.list(workspaceId, documentId);
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    this.permissions.assertCanComment(membership.role);
    return this.commentsService.create(workspaceId, documentId, user.sub, dto);
  }

  @Patch(':commentId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    this.permissions.assertCanComment(membership.role);
    return this.commentsService.update(
      workspaceId,
      documentId,
      commentId,
      user.sub,
      dto,
    );
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':commentId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    this.permissions.assertCanComment(membership.role);
    await this.commentsService.remove(
      workspaceId,
      documentId,
      commentId,
      user.sub,
      membership.role,
    );
  }

  @Post(':commentId/resolve')
  async resolve(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<CommentResponseDto> {
    this.permissions.assertCanComment(membership.role);
    return this.commentsService.resolve(
      workspaceId,
      documentId,
      commentId,
      user.sub,
    );
  }

  @Post(':commentId/reopen')
  async reopen(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
  ): Promise<CommentResponseDto> {
    this.permissions.assertCanComment(membership.role);
    return this.commentsService.reopen(
      workspaceId,
      documentId,
      commentId,
      user.sub,
    );
  }
}
