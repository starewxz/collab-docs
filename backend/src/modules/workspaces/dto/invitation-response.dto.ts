import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '../workspace-role.enum';

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export class InvitationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  workspaceId: string;

  @ApiProperty()
  workspaceName: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: WorkspaceRole })
  role: WorkspaceRole;

  @ApiProperty({ enum: ['pending', 'accepted', 'rejected', 'expired'] })
  status: InvitationStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    required: false,
    description: 'Development only - never populated in production',
  })
  inviteToken?: string;

  @ApiProperty({
    required: false,
    description: 'Development only - never populated in production',
  })
  inviteUrl?: string;
}
