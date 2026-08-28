import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentMembership } from '../workspaces/decorators/current-membership.decorator';
import type { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspaceMembershipGuard } from '../workspaces/guards/workspace-membership.guard';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';
import { BillingService } from './billing.service';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';

/** Billing mutations reuse `assertCanManageWorkspaceSettings` (OWNER only)
 * - the same permission that already gates other workspace-wide settings.
 * Viewing the plan/usage is available to any member (any role can see
 * "we're on the FREE plan, X/50 documents used"). */
@ApiBearerAuth()
@ApiTags('billing')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces/:workspaceId/billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly permissions: WorkspacePermissionsService,
  ) {}

  @Get()
  async getSubscription(
    @Param('workspaceId') workspaceId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.billingService.getSubscriptionSummary(workspaceId);
  }

  @Post('checkout')
  async checkout(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ) {
    this.permissions.assertCanManageWorkspaceSettings(membership.role);
    return this.billingService.createCheckoutSession(workspaceId);
  }

  /** Dev-only stand-in for a real provider calling our webhook - see
   * BillingService.mockConfirmPayment. */
  @Post('mock-pay')
  async mockPay(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<SubscriptionResponseDto> {
    this.permissions.assertCanManageWorkspaceSettings(membership.role);
    return this.billingService.mockConfirmPayment(workspaceId);
  }

  @Post('downgrade')
  async downgrade(
    @Param('workspaceId') workspaceId: string,
    @CurrentMembership() membership: WorkspaceMember,
  ): Promise<SubscriptionResponseDto> {
    this.permissions.assertCanManageWorkspaceSettings(membership.role);
    return this.billingService.downgradeToFree(workspaceId);
  }
}
