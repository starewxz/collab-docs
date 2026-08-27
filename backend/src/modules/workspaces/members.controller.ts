import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentMembership } from './decorators/current-membership.decorator';
import { MembershipResponseDto } from './dto/membership-response.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceMembershipGuard } from './guards/workspace-membership.guard';
import { MembersService } from './members.service';

@ApiBearerAuth()
@ApiTags('workspace members')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces/:workspaceId/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
  ): Promise<MembershipResponseDto[]> {
    return this.membersService.list(workspaceId);
  }

  // Declared before ':memberId' so "me" is never captured as a member id.
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('me')
  async leave(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<void> {
    await this.membersService.leave(workspaceId, membership);
  }

  @Patch(':memberId')
  async changeRole(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentMembership() membership: WorkspaceMember,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<MembershipResponseDto> {
    return this.membersService.changeRole(
      workspaceId,
      memberId,
      membership.role,
      dto.role,
    );
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':memberId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<void> {
    await this.membersService.remove(workspaceId, memberId, membership.role);
  }
}
