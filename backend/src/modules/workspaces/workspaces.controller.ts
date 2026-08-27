import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { CurrentMembership } from './decorators/current-membership.decorator';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceResponseDto } from './dto/workspace-response.dto';
import { WorkspaceMembershipGuard } from './guards/workspace-membership.guard';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspacesService } from './workspaces.service';

@ApiBearerAuth()
@ApiTags('workspaces')
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    return this.workspacesService.createWorkspace(user.sub, dto);
  }

  @Get()
  async listMine(
    @CurrentUser() user: JwtPayload,
  ): Promise<WorkspaceResponseDto[]> {
    return this.workspacesService.listForUser(user.sub);
  }

  @UseGuards(WorkspaceMembershipGuard)
  @Get(':workspaceId')
  async getOne(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<WorkspaceResponseDto> {
    const workspace = await this.workspacesService.getWorkspace(workspaceId);
    return WorkspaceResponseDto.fromEntity(workspace, membership.role);
  }
}
