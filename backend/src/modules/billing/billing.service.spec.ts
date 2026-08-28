import { BillingService } from './billing.service';
import { SubscriptionPlan } from './subscription-plan.enum';
import { SubscriptionStatus } from './subscription-status.enum';

function buildService() {
  const subscriptionRows: Record<string, unknown>[] = [];
  const eventRows: Record<string, unknown>[] = [];

  const subscriptions = {
    findOne: jest.fn(({ where }: { where: { workspaceId: string } }) =>
      Promise.resolve(
        subscriptionRows.find((r) => r.workspaceId === where.workspaceId) ??
          null,
      ),
    ),
    save: jest.fn((entity: Record<string, unknown>) => {
      const idx = subscriptionRows.findIndex((r) => r.id === entity.id);
      if (idx === -1) subscriptionRows.push(entity);
      else subscriptionRows[idx] = entity;
      return Promise.resolve(entity);
    }),
    create: jest.fn((data: Record<string, unknown>) => ({
      id: `sub-${subscriptionRows.length + 1}`,
      ...data,
    })),
  };

  interface FakeInsertResult {
    identifiers: ({ id: string } | null)[];
    raw: unknown[];
    generatedMaps: unknown[];
  }
  interface FakeInsertQueryBuilder {
    insert: () => FakeInsertQueryBuilder;
    into: () => FakeInsertQueryBuilder;
    values: (v: Record<string, unknown>) => FakeInsertQueryBuilder;
    orIgnore: () => FakeInsertQueryBuilder;
    execute: () => Promise<FakeInsertResult>;
  }
  const webhookEvents = {
    createQueryBuilder: jest.fn((): FakeInsertQueryBuilder => {
      let pendingValues: Record<string, unknown> | undefined;
      const qb: FakeInsertQueryBuilder = {
        insert: () => qb,
        into: () => qb,
        values: (v: Record<string, unknown>) => {
          pendingValues = v;
          return qb;
        },
        orIgnore: () => qb,
        execute: () => {
          const exists = eventRows.some(
            (r) => r.eventId === pendingValues?.eventId,
          );
          if (exists) {
            // Real TypeORM/Postgres ON CONFLICT DO NOTHING still returns
            // one `identifiers` entry per input row, just `null` - an
            // empty array here would mask the exact bug this fixture
            // caught (see BillingService.applyEvent).
            return Promise.resolve({
              identifiers: [null],
              raw: [],
              generatedMaps: [],
            });
          }
          const row = { id: `evt-${eventRows.length + 1}`, ...pendingValues };
          eventRows.push(row);
          return Promise.resolve({
            identifiers: [{ id: row.id }],
            raw: [],
            generatedMaps: [],
          });
        },
      };
      return qb;
    }),
  };

  const provider = {
    createCheckoutSession: jest.fn(() =>
      Promise.resolve({ sessionId: 'sess-1', checkoutUrl: 'mock://x' }),
    ),
  };
  const entitlements = {
    getUsageSummary: jest.fn(() =>
      Promise.resolve({ members: 1, documents: 1, storageBytes: 0 }),
    ),
    getLimits: jest.fn(() => ({
      maxMembers: 5,
      maxDocuments: 50,
      maxStorageBytes: 100,
      features: {},
    })),
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const metrics = { subscriptionStateChangesTotal: { inc: jest.fn() } };

  const service = new BillingService(
    subscriptions as never,
    webhookEvents as never,
    provider,
    entitlements as never,
    logger as never,
    metrics as never,
  );

  return { service, subscriptionRows, eventRows, metrics };
}

describe('BillingService', () => {
  describe('createDefaultSubscription', () => {
    it('creates a FREE/active subscription with no period end', async () => {
      const { service, subscriptionRows } = buildService();
      const manager = {
        save: jest.fn((e: unknown) => e),
        create: jest.fn((_e: unknown, d: Record<string, unknown>) => d),
      };
      await service.createDefaultSubscription(manager as never, 'ws-1');

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: null,
        }),
      );
      void subscriptionRows;
    });
  });

  describe('applyEvent (idempotency)', () => {
    it('upgrades to PRO on a checkout.completed event', async () => {
      const { service, subscriptionRows } = buildService();
      subscriptionRows.push({
        id: 'sub-1',
        workspaceId: 'ws-1',
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: null,
      });

      await service.applyEvent({
        eventId: 'evt-1',
        workspaceId: 'ws-1',
        type: 'checkout.completed',
        plan: 'pro',
      });

      expect(subscriptionRows[0].plan).toBe(SubscriptionPlan.PRO);
      expect(subscriptionRows[0].currentPeriodEnd).not.toBeNull();
    });

    it('does not re-apply the same eventId twice (duplicate webhook delivery)', async () => {
      const { service, subscriptionRows, metrics } = buildService();
      subscriptionRows.push({
        id: 'sub-1',
        workspaceId: 'ws-1',
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: null,
      });

      await service.applyEvent({
        eventId: 'evt-dup',
        workspaceId: 'ws-1',
        type: 'checkout.completed',
        plan: 'pro',
      });
      const firstPeriodEnd = subscriptionRows[0].currentPeriodEnd;

      await service.applyEvent({
        eventId: 'evt-dup',
        workspaceId: 'ws-1',
        type: 'checkout.completed',
        plan: 'pro',
      });

      expect(subscriptionRows[0].currentPeriodEnd).toBe(firstPeriodEnd);
      expect(
        metrics.subscriptionStateChangesTotal.inc,
      ).toHaveBeenLastCalledWith({ result: 'duplicate' });
    });

    it('downgrades to FREE on a subscription.canceled event', async () => {
      const { service, subscriptionRows } = buildService();
      subscriptionRows.push({
        id: 'sub-1',
        workspaceId: 'ws-1',
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(),
      });

      await service.applyEvent({
        eventId: 'evt-cancel',
        workspaceId: 'ws-1',
        type: 'subscription.canceled',
      });

      expect(subscriptionRows[0].plan).toBe(SubscriptionPlan.FREE);
      expect(subscriptionRows[0].currentPeriodEnd).toBeNull();
    });
  });

  describe('mockConfirmPayment / downgradeToFree', () => {
    it('mockConfirmPayment upgrades the workspace to PRO', async () => {
      const { service, subscriptionRows } = buildService();
      subscriptionRows.push({
        id: 'sub-1',
        workspaceId: 'ws-1',
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: null,
      });

      const summary = await service.mockConfirmPayment('ws-1');
      expect(summary.plan).toBe(SubscriptionPlan.PRO);
    });

    it('downgradeToFree reverts the workspace to FREE without deleting the row', async () => {
      const { service, subscriptionRows } = buildService();
      subscriptionRows.push({
        id: 'sub-1',
        workspaceId: 'ws-1',
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(),
      });

      const summary = await service.downgradeToFree('ws-1');
      expect(summary.plan).toBe(SubscriptionPlan.FREE);
      expect(subscriptionRows).toHaveLength(1); // row preserved, not deleted
    });
  });
});
