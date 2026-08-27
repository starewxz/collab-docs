import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum } from 'class-validator';
import { WorkspaceRole } from '../workspace-role.enum';

export class InviteMemberDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({
    enum: WorkspaceRole,
    description: 'OWNER is not invitable',
  })
  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}
