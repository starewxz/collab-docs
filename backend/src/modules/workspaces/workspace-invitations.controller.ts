import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { CurrentMembership } from './decorators/current-membership.decorator';
import { InvitationResponseDto } from './dto/invitation-response.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceMembershipGuard } from './guards/workspace-membership.guard';
import { InvitationsService } from './invitations.service';
import { WorkspacePermissionsService } from './workspace-permissions.service';

@ApiBearerAuth()
@ApiTags('workspace invitations')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces/:workspaceId/invitations')
export class WorkspaceInvitationsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly permissions: WorkspacePermissionsService,
  ) {}

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @CurrentUser() user: JwtPayload,
    @Body() dto: InviteMemberDto,
  ): Promise<InvitationResponseDto> {
    this.permissions.assertCanInviteMembers(membership.role);
    return this.invitationsService.create(workspaceId, user.sub, dto);
  }

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<InvitationResponseDto[]> {
    this.permissions.assertCanViewInvitations(membership.role);
    return this.invitationsService.listForWorkspace(workspaceId);
  }
}
