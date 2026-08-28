import { randomUUID } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { EntityManager, Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { EntitlementsService } from './entitlements.service';
import { BillingWebhookEvent } from './entities/billing-webhook-event.entity';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './providers/payment-provider.interface';
import { SubscriptionPlan } from './subscription-plan.enum';
import { SubscriptionStatus } from './subscription-status.enum';

const PRO_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(BillingWebhookEvent)
    private readonly webhookEvents: Repository<BillingWebhookEvent>,
    @Inject(PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
    private readonly entitlements: EntitlementsService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext(BillingService.name);
  }

  /** Called inside WorkspacesService.createWorkspace's own transaction -
   * a workspace must never exist without a subscription row. */
  async createDefaultSubscription(
    manager: EntityManager,
    workspaceId: string,
  ): Promise<void> {
    await manager.save(
      manager.create(Subscription, {
        workspaceId,
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: null,
      }),
    );
  }

  async getSubscriptionSummary(
    workspaceId: string,
  ): Promise<SubscriptionResponseDto> {
    const subscription = await this.getScoped(workspaceId);
    const usage = await this.entitlements.getUsageSummary(workspaceId);
    const limits = this.entitlements.getLimits(subscription.plan);
    return SubscriptionResponseDto.fromEntity(subscription, usage, limits);
  }

  /** Only PRO exists today, so there's nothing to choose - a body/param
   * would exist here if/when a second paid tier is added. */
  async createCheckoutSession(workspaceId: string) {
    await this.getScoped(workspaceId); // 404 if the workspace has no subscription row somehow
    return this.provider.createCheckoutSession(
      workspaceId,
      SubscriptionPlan.PRO,
    );
  }

  /** Dev-only stand-in for a real provider's asynchronous webhook call -
   * there is no external service to redirect to/from in mock mode. Both
   * this and the real webhook endpoint converge on the same idempotent
   * `applyEvent`. A real Stripe integration would delete this method and
   * this method only, keeping applyEvent/the webhook controller as-is. */
  async mockConfirmPayment(
    workspaceId: string,
  ): Promise<SubscriptionResponseDto> {
    await this.applyEvent({
      eventId: `mock_${randomUUID()}`,
      workspaceId,
      type: 'checkout.completed',
      plan: 'pro',
    });
    return this.getSubscriptionSummary(workspaceId);
  }

  async downgradeToFree(workspaceId: string): Promise<SubscriptionResponseDto> {
    await this.applyEvent({
      eventId: `manual-downgrade_${randomUUID()}`,
      workspaceId,
      type: 'subscription.canceled',
    });
    return this.getSubscriptionSummary(workspaceId);
  }

  /**
   * The single place subscription state actually changes, called by both
   * the real webhook controller and the mock-pay dev shortcut.
   * Idempotent via a unique `eventId` - the same durable-uniqueness
   * pattern as Notification.dedupeKey (ADR-015): `INSERT ... ON CONFLICT
   * DO NOTHING` is the guarantee, not "was this call made before" logic
   * in application code. Downgrading never deletes data - it only flips
   * `plan`/`status`, which the already-existing count-based entitlement
   * checks re-evaluate on the next create/invite/upload attempt (see
   * ADR-019 for why no separate "downgrade cleanup" step exists).
   */
  async applyEvent(event: {
    eventId: string;
    workspaceId: string;
    type: 'checkout.completed' | 'subscription.canceled';
    plan?: 'pro';
  }): Promise<void> {
    const result = await this.webhookEvents
      .createQueryBuilder()
      .insert()
      .into(BillingWebhookEvent)
      .values({
        eventId: event.eventId,
        workspaceId: event.workspaceId,
        type: event.type,
      })
      .orIgnore()
      .execute();

    // On a conflict, `ON CONFLICT DO NOTHING` still returns an
    // `identifiers` entry per input row, but with a `null` placeholder
    // (not an empty array) - checking `.length` alone is wrong and would
    // treat every duplicate delivery as newly applied.
    const applied = result.identifiers.some((id) => id != null);
    this.metrics.subscriptionStateChangesTotal.inc({
      result: applied ? 'applied' : 'duplicate',
    });
    if (!applied) {
      this.logger.info(
        { event: 'billing_webhook_duplicate_skipped', type: event.type },
        'billing_webhook_duplicate_skipped',
      );
      return;
    }

    const subscription = await this.getScoped(event.workspaceId);
    if (event.type === 'checkout.completed') {
      subscription.plan = SubscriptionPlan.PRO;
      subscription.status = SubscriptionStatus.ACTIVE;
      subscription.currentPeriodEnd = new Date(Date.now() + PRO_PERIOD_MS);
    } else {
      subscription.plan = SubscriptionPlan.FREE;
      subscription.status = SubscriptionStatus.ACTIVE;
      subscription.currentPeriodEnd = null;
    }
    await this.subscriptions.save(subscription);

    this.logger.info(
      {
        event: 'subscription_state_changed',
        type: event.type,
        plan: subscription.plan,
      },
      'subscription_state_changed',
    );
  }

  private async getScoped(workspaceId: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findOne({
      where: { workspaceId },
    });
    if (!subscription) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    return subscription;
  }
}
