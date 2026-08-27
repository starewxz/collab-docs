import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { MembershipResponseDto } from './dto/membership-response.dto';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspacePermissionsService } from './workspace-permissions.service';
import { WorkspaceRole } from './workspace-role.enum';

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly permissions: WorkspacePermissionsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MembersService.name);
  }

  async list(workspaceId: string): Promise<MembershipResponseDto[]> {
    const members = await this.members.find({ where: { workspaceId } });
    if (members.length === 0) {
      return [];
    }

    const users = await this.users.findBy({
      id: In(members.map((m) => m.userId)),
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return members
      .map((member) => this.toDto(member, userById.get(member.userId)))
      .filter((dto): dto is MembershipResponseDto => dto !== null);
  }

  async changeRole(
    workspaceId: string,
    memberId: string,
    actorRole: WorkspaceRole,
    newRole: WorkspaceRole,
  ): Promise<MembershipResponseDto> {
    // Scoped by workspaceId too, not just memberId, so a memberId from a
    // different workspace can never be targeted (IDOR guard).
    const target = await this.members.findOne({
      where: { id: memberId, workspaceId },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }

    this.permissions.assertCanChangeMemberRole(actorRole, target.role, newRole);

    target.role = newRole;
    await this.members.save(target);

    this.logger.info(
      {
        event: 'workspace_member_role_changed',
        workspaceId,
        memberId,
        newRole,
      },
      'workspace_member_role_changed',
    );

    const user = await this.users.findOne({ where: { id: target.userId } });
    const dto = this.toDto(target, user ?? undefined);
    if (!dto) {
      throw new NotFoundException('Member not found');
    }
    return dto;
  }

  async remove(
    workspaceId: string,
    memberId: string,
    actorRole: WorkspaceRole,
  ): Promise<void> {
    const target = await this.members.findOne({
      where: { id: memberId, workspaceId },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }

    this.permissions.assertCanRemoveMember(actorRole, target.role);

    await this.members.remove(target);

    this.logger.info(
      { event: 'workspace_member_removed', workspaceId, memberId },
      'workspace_member_removed',
    );
  }

  async leave(workspaceId: string, membership: WorkspaceMember): Promise<void> {
    if (!this.permissions.canLeaveWorkspace(membership.role)) {
      throw new BadRequestException(
        'The workspace owner cannot leave. Delete the workspace or transfer ownership instead.',
      );
    }

    await this.members.remove(membership);

    this.logger.info(
      {
        event: 'workspace_member_removed',
        workspaceId,
        memberId: membership.id,
        selfService: true,
      },
      'workspace_member_removed',
    );
  }

  private toDto(
    member: WorkspaceMember,
    user: User | undefined,
  ): MembershipResponseDto | null {
    if (!user) {
      return null;
    }
    const dto = new MembershipResponseDto();
    dto.id = member.id;
    dto.userId = member.userId;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.role = member.role;
    dto.joinedAt = member.joinedAt;
    return dto;
  }
}
