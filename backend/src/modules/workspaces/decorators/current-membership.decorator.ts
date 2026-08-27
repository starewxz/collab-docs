import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithMembership } from '../guards/workspace-membership.guard';
import type { WorkspaceMember } from '../entities/workspace-member.entity';

/** Requires WorkspaceMembershipGuard to have run first on the same route. */
export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceMember => {
    const request = ctx.switchToHttp().getRequest<RequestWithMembership>();
    return request.membership;
  },
);
