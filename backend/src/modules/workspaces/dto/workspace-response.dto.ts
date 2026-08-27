import { ApiProperty } from '@nestjs/swagger';
import type { Workspace } from '../entities/workspace.entity';
import { WorkspaceRole } from '../workspace-role.enum';

export class WorkspaceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: WorkspaceRole, description: "Current user's role" })
  role: WorkspaceRole;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(
    workspace: Workspace,
    role: WorkspaceRole,
  ): WorkspaceResponseDto {
    const dto = new WorkspaceResponseDto();
    dto.id = workspace.id;
    dto.name = workspace.name;
    dto.slug = workspace.slug;
    dto.role = role;
    dto.createdAt = workspace.createdAt;
    return dto;
  }
}
