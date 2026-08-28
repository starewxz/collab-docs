import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In, Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { hashInvitationToken } from '../auth/utils/hash-token.util';
import { User } from '../users/user.entity';
import {
  InvitationResponseDto,
  InvitationStatus,
} from './dto/invitation-response.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceInvitation } from './entities/workspace-invitation.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceRole } from './workspace-role.enum';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class InvitationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(WorkspaceInvitation)
    private readonly invitations: Repository<WorkspaceInvitation>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
    private readonly entitlements: EntitlementsService,
  ) {
    this.logger.setContext(InvitationsService.name);
  }

  async create(
    workspaceId: string,
    invitedById: string,
    dto: InviteMemberDto,
  ): Promise<InvitationResponseDto> {
    if (dto.role === WorkspaceRole.OWNER) {
      throw new BadRequestException('Cannot invite someone as OWNER');
    }

    const email = normalizeEmail(dto.email);

    const existingUser = await this.users.findOne({ where: { email } });
    if (existingUser) {
      const existingMembership = await this.members.findOne({
        where: { workspaceId, userId: existingUser.id },
      });
      if (existingMembership) {
        throw new ConflictException(
          'This person is already a member of the workspace',
        );
      }
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    let invitation: WorkspaceInvitation;
    try {
      invitation = await this.invitations.save(
        this.invitations.create({
          workspaceId,
          email,
          role: dto.role,
          tokenHash,
          invitedById,
          expiresAt,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'An active invitation already exists for this email',
        );
      }
      throw error;
    }

    this.metrics.workspaceInvitationsTotal.inc({ status: 'created' });
    this.logger.info(
      {
        event: 'workspace_invitation_created',
        workspaceId,
        invitationId: invitation.id,
      },
      'workspace_invitation_created',
    );

    const workspace = await this.workspaces.findOne({
      where: { id: workspaceId },
    });
    const dtoOut = this.toDto(invitation, workspace?.name ?? '');

    if (this.config.app.nodeEnv !== 'production') {
      dtoOut.inviteToken = rawToken;
      dtoOut.inviteUrl = `${this.config.app.frontendUrl}/invitations/${rawToken}`;
    }

    return dtoOut;
  }

  async listForWorkspace(
    workspaceId: string,
  ): Promise<InvitationResponseDto[]> {
    const invitations = await this.invitations.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
    const workspace = await this.workspaces.findOne({
      where: { id: workspaceId },
    });
    return invitations.map((invitation) =>
      this.toDto(invitation, workspace?.name ?? ''),
    );
  }

  async listForEmail(email: string): Promise<InvitationResponseDto[]> {
    const normalized = normalizeEmail(email);
    const invitations = await this.invitations.find({
      where: { email: normalized },
      order: { createdAt: 'DESC' },
    });
    if (invitations.length === 0) {
      return [];
    }

    const workspaces = await this.workspaces.findBy({
      id: In(invitations.map((i) => i.workspaceId)),
    });
    const workspaceById = new Map(workspaces.map((w) => [w.id, w]));

    return invitations.map((invitation) =>
      this.toDto(
        invitation,
        workspaceById.get(invitation.workspaceId)?.name ?? '',
      ),
    );
  }

  /** Entry point for someone following the emailed invite link. */
  async accept(
    rawToken: string,
    currentUser: { sub: string; email: string },
  ): Promise<{ workspaceId: string }> {
    return this.performAccept(
      { tokenHash: hashInvitationToken(rawToken) },
      currentUser,
    );
  }

  /**
   * Entry point for someone who is already logged in and acting on an
   * invitation surfaced by GET /invitations/me. The raw token is a one-way
   * hash in storage and can never be recovered for that listing, so this
   * path authorizes purely on "logged-in user's email matches the
   * invitation's email" instead - exactly the same check the token-based
   * path makes, just without needing the secret back.
   */
  async acceptById(
    invitationId: string,
    currentUser: { sub: string; email: string },
  ): Promise<{ workspaceId: string }> {
    return this.performAccept({ id: invitationId }, currentUser);
  }

  private async performAccept(
    criteria:
      Pick<WorkspaceInvitation, 'tokenHash'> | Pick<WorkspaceInvitation, 'id'>,
    currentUser: { sub: string; email: string },
  ): Promise<{ workspaceId: string }> {
    return this.dataSource.transaction(async (manager) => {
      const invitation = await manager.findOne(WorkspaceInvitation, {
        where: criteria,
        lock: { mode: 'pessimistic_write' },
      });

      this.assertActionable(invitation, currentUser.email);
      const invitationRow = invitation!;

      const existingMembership = await manager.findOne(WorkspaceMember, {
        where: {
          workspaceId: invitationRow.workspaceId,
          userId: currentUser.sub,
        },
      });

      if (!existingMembership) {
        // Locking the Workspace row here (in addition to the invitation
        // row locked above) serializes concurrent accepts of *different*
        // invitations for the *same* workspace, so the member-count check
        // right after can't be raced past the plan limit - see ADR-019.
        await this.entitlements.lockWorkspace(
          manager,
          invitationRow.workspaceId,
        );
        await this.entitlements.assertCanInviteMember(
          manager,
          invitationRow.workspaceId,
        );
        try {
          await manager.save(
            manager.create(WorkspaceMember, {
              workspaceId: invitationRow.workspaceId,
              userId: currentUser.sub,
              role: invitationRow.role,
            }),
          );
        } catch (error) {
          if (!this.isUniqueViolation(error)) {
            throw error;
          }
          // Someone else's concurrent request already created it - fine,
          // the invariant (exactly one membership) still holds.
        }
      }

      invitationRow.acceptedAt = new Date();
      await manager.save(invitationRow);

      this.metrics.workspaceInvitationsTotal.inc({ status: 'accepted' });
      this.logger.info(
        {
          event: 'workspace_invitation_accepted',
          workspaceId: invitationRow.workspaceId,
          invitationId: invitationRow.id,
        },
        'workspace_invitation_accepted',
      );

      return { workspaceId: invitationRow.workspaceId };
    });
  }

  async reject(
    rawToken: string,
    currentUser: { sub: string; email: string },
  ): Promise<void> {
    return this.performReject(
      { tokenHash: hashInvitationToken(rawToken) },
      currentUser,
    );
  }

  async rejectById(
    invitationId: string,
    currentUser: { sub: string; email: string },
  ): Promise<void> {
    return this.performReject({ id: invitationId }, currentUser);
  }

  private async performReject(
    criteria:
      Pick<WorkspaceInvitation, 'tokenHash'> | Pick<WorkspaceInvitation, 'id'>,
    currentUser: { sub: string; email: string },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const invitation = await manager.findOne(WorkspaceInvitation, {
        where: criteria,
        lock: { mode: 'pessimistic_write' },
      });

      this.assertActionable(invitation, currentUser.email);
      const invitationRow = invitation!;

      invitationRow.rejectedAt = new Date();
      await manager.save(invitationRow);

      this.metrics.workspaceInvitationsTotal.inc({ status: 'rejected' });
      this.logger.info(
        {
          event: 'workspace_invitation_rejected',
          workspaceId: invitationRow.workspaceId,
          invitationId: invitationRow.id,
        },
        'workspace_invitation_rejected',
      );
    });
  }

  private assertActionable(
    invitation: WorkspaceInvitation | null,
    currentUserEmail: string,
  ): void {
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.acceptedAt) {
      throw new ConflictException('Invitation already accepted');
    }
    if (invitation.rejectedAt) {
      throw new ConflictException('Invitation already rejected');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Invitation has expired');
    }
    if (normalizeEmail(currentUserEmail) !== invitation.email) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }
  }

  private toDto(
    invitation: WorkspaceInvitation,
    workspaceName: string,
  ): InvitationResponseDto {
    const dto = new InvitationResponseDto();
    dto.id = invitation.id;
    dto.workspaceId = invitation.workspaceId;
    dto.workspaceName = workspaceName;
    dto.email = invitation.email;
    dto.role = invitation.role;
    dto.status = this.computeStatus(invitation);
    dto.expiresAt = invitation.expiresAt;
    dto.createdAt = invitation.createdAt;
    return dto;
  }

  private computeStatus(invitation: WorkspaceInvitation): InvitationStatus {
    if (invitation.acceptedAt) return 'accepted';
    if (invitation.rejectedAt) return 'rejected';
    if (invitation.expiresAt.getTime() < Date.now()) return 'expired';
    return 'pending';
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === UNIQUE_VIOLATION
    );
  }
}
