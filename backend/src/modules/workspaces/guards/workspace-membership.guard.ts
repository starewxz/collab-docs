import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request';
import { WorkspaceMember } from '../entities/workspace-member.entity';

export interface RequestWithMembership extends AuthenticatedRequest {
  membership: WorkspaceMember;
}

/**
 * Resolves the current user's membership for the `:workspaceId` route
 * param. Non-members (and non-existent workspaces) both get 404, never
 * 403 - this project's deliberate policy is to not disclose whether a
 * workspace exists to people outside it. Must run after JwtAuthGuard.
 */
@Injectable()
export class WorkspaceMembershipGuard implements CanActivate {
  constructor(
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithMembership>();
    const workspaceId = request.params.workspaceId;
    if (typeof workspaceId !== 'string') {
      throw new BadRequestException('Missing workspaceId');
    }

    const membership = await this.members.findOne({
      where: { workspaceId, userId: request.user.sub },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }

    request.membership = membership;
    return true;
  }
}
