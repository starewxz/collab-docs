import { ForbiddenException } from '@nestjs/common';
import { Document } from '../documents/entities/document.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionPlan } from './subscription-plan.enum';

interface FindOperatorLike {
  type: string;
  value: unknown;
}

function isOperator(value: unknown): value is FindOperatorLike {
  return !!value && typeof value === 'object' && 'type' in value;
}

function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const val = row[key];
    if (isOperator(cond)) {
      if (cond.type === 'isNull') return val === null;
    }
    return val === cond;
  });
}

function buildService(options: {
  plan?: SubscriptionPlan;
  memberCount?: number;
  documentCount?: number;
  attachmentSizes?: number[];
}) {
  const subscription = {
    workspaceId: 'ws-1',
    plan: options.plan ?? SubscriptionPlan.FREE,
  };
  const subscriptions = {
    findOne: jest.fn(() => Promise.resolve(subscription)),
  };
  const memberRows = Array.from(
    { length: options.memberCount ?? 0 },
    (_, i) => ({
      id: `m-${i}`,
      workspaceId: 'ws-1',
    }),
  );
  const members = {
    count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(memberRows.filter((r) => matches(r, where)).length),
    ),
  };
  const documentRows = Array.from(
    { length: options.documentCount ?? 0 },
    (_, i) => ({
      id: `d-${i}`,
      workspaceId: 'ws-1',
      archivedAt: null,
    }),
  );
  const documents = {
    count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(documentRows.filter((r) => matches(r, where)).length),
    ),
  };
  const attachmentSum = (options.attachmentSizes ?? []).reduce(
    (a, b) => a + b,
    0,
  );
  interface FakeSumQueryBuilder {
    innerJoin: () => FakeSumQueryBuilder;
    where: () => FakeSumQueryBuilder;
    select: () => FakeSumQueryBuilder;
    getRawOne: () => Promise<{ sum: string }>;
  }
  const attachments = {
    createQueryBuilder: jest.fn((): FakeSumQueryBuilder => {
      const qb: FakeSumQueryBuilder = {
        innerJoin: () => qb,
        where: () => qb,
        select: () => qb,
        getRawOne: () => Promise.resolve({ sum: String(attachmentSum) }),
      };
      return qb;
    }),
  };
  const metrics = { planLimitRejectionsTotal: { inc: jest.fn() } };

  const service = new EntitlementsService(
    subscriptions as never,
    members as never,
    documents as never,
    attachments as never,
    metrics as never,
  );

  // assertCanCreateDocument/assertCanInviteMember take a real
  // EntityManager (used inside the caller's own locked transaction) - this
  // fake dispatches .count() by entity class, reusing the same repo fakes.
  const manager = {
    count: jest.fn(
      (entity: unknown, options: { where: Record<string, unknown> }) => {
        if (entity === Document) return documents.count(options);
        if (entity === WorkspaceMember) return members.count(options);
        throw new Error('Unexpected entity in fake manager.count');
      },
    ),
  };

  return { service, metrics, manager };
}

describe('EntitlementsService', () => {
  describe('assertCanCreateDocument', () => {
    it('allows creation below the FREE limit', async () => {
      const { service, manager } = buildService({ documentCount: 10 });
      await expect(
        service.assertCanCreateDocument(manager as never, 'ws-1'),
      ).resolves.toBeUndefined();
    });

    it('rejects at the FREE limit (50 documents)', async () => {
      const { service, metrics, manager } = buildService({ documentCount: 50 });
      await expect(
        service.assertCanCreateDocument(manager as never, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(metrics.planLimitRejectionsTotal.inc).toHaveBeenCalledWith({
        limit: 'documents',
      });
    });

    it('PRO has no document limit', async () => {
      const { service, manager } = buildService({
        plan: SubscriptionPlan.PRO,
        documentCount: 10_000,
      });
      await expect(
        service.assertCanCreateDocument(manager as never, 'ws-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertCanInviteMember', () => {
    it('rejects at the FREE limit (5 members)', async () => {
      const { service, manager } = buildService({ memberCount: 5 });
      await expect(
        service.assertCanInviteMember(manager as never, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('PRO has no member limit', async () => {
      const { service, manager } = buildService({
        plan: SubscriptionPlan.PRO,
        memberCount: 500,
      });
      await expect(
        service.assertCanInviteMember(manager as never, 'ws-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertCanUploadAttachment', () => {
    it('rejects when the additional bytes would exceed the FREE storage allowance', async () => {
      const { service } = buildService({
        attachmentSizes: [99 * 1024 * 1024],
      });
      await expect(
        service.assertCanUploadAttachment('ws-1', 2 * 1024 * 1024),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an upload within the FREE storage allowance', async () => {
      const { service } = buildService({ attachmentSizes: [] });
      await expect(
        service.assertCanUploadAttachment('ws-1', 1024),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertFeatureEnabled', () => {
    it('rejects a FREE-gated feature', async () => {
      const { service } = buildService({});
      await expect(
        service.assertFeatureEnabled('ws-1', 'manualVersionSnapshots', 'nope'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the same feature on PRO', async () => {
      const { service } = buildService({ plan: SubscriptionPlan.PRO });
      await expect(
        service.assertFeatureEnabled('ws-1', 'manualVersionSnapshots', 'nope'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getUsageSummary', () => {
    it('reports member/document/storage usage together', async () => {
      const { service } = buildService({
        memberCount: 3,
        documentCount: 7,
        attachmentSizes: [100, 200],
      });
      const usage = await service.getUsageSummary('ws-1');
      expect(usage).toEqual({ members: 3, documents: 7, storageBytes: 300 });
    });
  });
});
