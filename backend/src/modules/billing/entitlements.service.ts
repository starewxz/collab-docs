import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { Attachment } from '../attachments/entities/attachment.entity';
import { Document } from '../documents/entities/document.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { PLAN_LIMITS } from './plan-limits';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionPlan } from './subscription-plan.enum';

/** Structured payload attached to a limit-exceeded ForbiddenException, so
 * the frontend can render a specific "upgrade to PRO" CTA instead of a
 * generic error. */
export interface PlanLimitExceededPayload {
  message: string;
  code: 'PLAN_LIMIT_EXCEEDED';
  limitType: 'members' | 'documents' | 'storage';
  limit: number;
  current: number;
  plan: SubscriptionPlan;
}

/**
 * The single place plan numbers/feature gates are read from. No
 * controller or service should compare `plan === 'pro'` or hardcode a
 * limit number directly - everything routes through here, mirroring how
 * WorkspacePermissionsService centralizes role logic. "Authorization"
 * (role) and "entitlement" (plan) are deliberately separate checks - see
 * ADR-019.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    private readonly metrics: MetricsService,
  ) {}

  async getPlan(workspaceId: string): Promise<SubscriptionPlan> {
    const subscription = await this.subscriptions.findOne({
      where: { workspaceId },
    });
    // Defensive fallback only - every workspace gets a row on creation.
    return subscription?.plan ?? SubscriptionPlan.FREE;
  }

  getLimits(plan: SubscriptionPlan) {
    return PLAN_LIMITS[plan];
  }

  featureEnabled(plan: SubscriptionPlan, feature: string): boolean {
    return Boolean(PLAN_LIMITS[plan].features[feature]);
  }

  async assertFeatureEnabled(
    workspaceId: string,
    feature: string,
    message: string,
  ): Promise<void> {
    const plan = await this.getPlan(workspaceId);
    if (!this.featureEnabled(plan, feature)) {
      this.metrics.planLimitRejectionsTotal.inc({ limit: feature });
      throw new ForbiddenException({
        message,
        code: 'PLAN_LIMIT_EXCEEDED',
        limitType: feature,
        plan,
      });
    }
  }

  /**
   * Called inside the caller's own transaction, with the workspace row
   * already locked (`SELECT ... FOR UPDATE`) by the caller - concurrent
   * document-creation requests for the same workspace serialize on that
   * lock, so two requests racing right at the limit can't both succeed.
   * See ADR-019.
   */
  async assertCanCreateDocument(
    manager: EntityManager,
    workspaceId: string,
  ): Promise<void> {
    const plan = await this.getPlan(workspaceId);
    const limit = this.getLimits(plan).maxDocuments;
    if (limit === null) return;

    const current = await manager.count(Document, {
      where: { workspaceId, archivedAt: IsNull() },
    });
    if (current >= limit) {
      this.metrics.planLimitRejectionsTotal.inc({ limit: 'documents' });
      throw new ForbiddenException({
        message: `This workspace has reached its ${plan.toUpperCase()} plan limit of ${limit} documents`,
        code: 'PLAN_LIMIT_EXCEEDED',
        limitType: 'documents',
        limit,
        current,
        plan,
      } satisfies PlanLimitExceededPayload);
    }
  }

  /** Same locking contract as assertCanCreateDocument - the caller must
   * have already locked the Workspace row in the same transaction. */
  async assertCanInviteMember(
    manager: EntityManager,
    workspaceId: string,
  ): Promise<void> {
    const plan = await this.getPlan(workspaceId);
    const limit = this.getLimits(plan).maxMembers;
    if (limit === null) return;

    const current = await manager.count(WorkspaceMember, {
      where: { workspaceId },
    });
    if (current >= limit) {
      this.metrics.planLimitRejectionsTotal.inc({ limit: 'members' });
      throw new ForbiddenException({
        message: `This workspace has reached its ${plan.toUpperCase()} plan limit of ${limit} members`,
        code: 'PLAN_LIMIT_EXCEEDED',
        limitType: 'members',
        limit,
        current,
        plan,
      } satisfies PlanLimitExceededPayload);
    }
  }

  /** Lighter-weight than the two above: counted-then-checked without a
   * workspace-row lock. Attachment uploads are two-phase (presigned URL,
   * then confirm) and already async/best-effort by nature, so a narrow
   * race window here is an accepted, documented trade-off rather than
   * the hard invariant document/member counts are - see ADR-019. */
  async assertCanUploadAttachment(
    workspaceId: string,
    additionalBytes: number,
  ): Promise<void> {
    const plan = await this.getPlan(workspaceId);
    const limit = this.getLimits(plan).maxStorageBytes;
    if (limit === null) return;

    const { sum } = (await this.attachments
      .createQueryBuilder('a')
      .innerJoin(Document, 'd', 'd.id = a.documentId')
      .where('d.workspaceId = :workspaceId', { workspaceId })
      .select('COALESCE(SUM(a.size), 0)', 'sum')
      .getRawOne<{ sum: string }>())!;
    const current = Number(sum);

    if (current + additionalBytes > limit) {
      this.metrics.planLimitRejectionsTotal.inc({ limit: 'storage' });
      throw new ForbiddenException({
        message: `This workspace has reached its ${plan.toUpperCase()} plan storage allowance`,
        code: 'PLAN_LIMIT_EXCEEDED',
        limitType: 'storage',
        limit,
        current,
        plan,
      } satisfies PlanLimitExceededPayload);
    }
  }

  async getUsageSummary(workspaceId: string): Promise<{
    members: number;
    documents: number;
    storageBytes: number;
  }> {
    const [members, documents, storage] = await Promise.all([
      this.members.count({ where: { workspaceId } }),
      this.documents.count({ where: { workspaceId, archivedAt: IsNull() } }),
      this.attachments
        .createQueryBuilder('a')
        .innerJoin(Document, 'd', 'd.id = a.documentId')
        .where('d.workspaceId = :workspaceId', { workspaceId })
        .select('COALESCE(SUM(a.size), 0)', 'sum')
        .getRawOne<{ sum: string }>(),
    ]);
    return {
      members,
      documents,
      storageBytes: Number(storage?.sum ?? 0),
    };
  }

  /** Exposed for services that need to lock the Workspace row themselves
   * before calling assertCanCreateDocument/assertCanInviteMember (they
   * already hold `manager` from their own transaction). */
  async lockWorkspace(
    manager: EntityManager,
    workspaceId: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder(Workspace, 'w')
      .setLock('pessimistic_write')
      .where('w.id = :id', { id: workspaceId })
      .getOne();
  }
}
