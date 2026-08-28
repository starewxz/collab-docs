import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceInvitation } from './entities/workspace-invitation.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceInvitationsController } from './workspace-invitations.controller';
import { WorkspaceMembershipGuard } from './guards/workspace-membership.guard';
import { WorkspacePermissionsService } from './workspace-permissions.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Workspace,
      WorkspaceMember,
      WorkspaceInvitation,
      User,
    ]),
  ],
  controllers: [
    WorkspacesController,
    MembersController,
    WorkspaceInvitationsController,
    InvitationsController,
  ],
  providers: [
    WorkspacesService,
    MembersService,
    InvitationsService,
    WorkspacePermissionsService,
    WorkspaceMembershipGuard,
  ],
  exports: [WorkspacePermissionsService, WorkspaceMembershipGuard],
})
export class WorkspacesModule {}
