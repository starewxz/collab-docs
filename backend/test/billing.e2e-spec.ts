import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const RUN_ID = Date.now();
const emailFor = (name: string) => `${name}-${RUN_ID}@example.com`;
const WEBHOOK_SECRET = process.env.BILLING_WEBHOOK_SECRET ?? '';

interface AuthResponseBody {
  accessToken: string;
  user: { id: string; email: string };
}

interface WorkspaceBody {
  id: string;
}

interface DocumentBody {
  id: string;
}

interface InvitationBody {
  inviteToken: string;
}

interface UsageItem {
  used: number;
  limit: number | null;
}

interface SubscriptionResponseBody {
  plan: 'free' | 'pro';
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: string | null;
  members: UsageItem;
  documents: UsageItem;
  storageBytes: UsageItem;
  features: Record<string, boolean>;
}

describe('Billing & plan limits (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(
    email: string,
    firstName: string,
  ): Promise<AuthResponseBody> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', firstName, lastName: 'Test' })
      .expect(201);
    return res.body as AuthResponseBody;
  }

  async function createWorkspace(token: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return (res.body as WorkspaceBody).id;
  }

  async function createDocument(
    token: string,
    workspaceId: string,
    title: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title });
  }

  async function createDocuments(
    token: string,
    workspaceId: string,
    count: number,
    titlePrefix: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const res = await createDocument(
        token,
        workspaceId,
        `${titlePrefix} ${i}`,
      );
      expect(res.status).toBe(201);
      ids.push((res.body as DocumentBody).id);
    }
    return ids;
  }

  async function getBilling(
    token: string,
    workspaceId: string,
  ): Promise<SubscriptionResponseBody> {
    const res = await request(app.getHttpServer())
      .get(`/api/workspaces/${workspaceId}/billing`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as SubscriptionResponseBody;
  }

  async function invite(
    ownerToken: string,
    workspaceId: string,
    email: string,
    role: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, role })
      .expect(201);
    return (res.body as InvitationBody).inviteToken;
  }

  async function acceptInvite(
    token: string,
    inviteToken: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/invitations/${inviteToken}/accept`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('6. a newly created workspace defaults to the FREE plan', async () => {
    const owner = await register(emailFor('billing-default-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Billing Default WS',
    );

    const billing = await getBilling(owner.accessToken, workspaceId);
    expect(billing.plan).toBe('free');
    expect(billing.status).toBe('active');
    expect(billing.documents.limit).toBe(50);
    expect(billing.members.limit).toBe(5);
  });

  it('7. plan/entitlement resolution reflects an upgrade to PRO', async () => {
    const owner = await register(emailFor('billing-resolve-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Billing Resolve WS',
    );

    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/billing/mock-pay`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(201);

    const billing = await getBilling(owner.accessToken, workspaceId);
    expect(billing.plan).toBe('pro');
    expect(billing.documents.limit).toBeNull(); // unlimited
    expect(billing.members.limit).toBeNull();
    expect(billing.features.manualVersionSnapshots).toBe(true);
  });

  it('8. a non-owner member cannot mutate billing', async () => {
    const owner = await register(emailFor('billing-authz-owner'), 'Owner');
    const editorEmail = emailFor('billing-authz-editor');
    const editor = await register(editorEmail, 'Editor');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Billing Authz WS',
    );
    const inviteToken = await invite(
      owner.accessToken,
      workspaceId,
      editorEmail,
      'EDITOR',
    );
    await acceptInvite(editor.accessToken, inviteToken).then((res) =>
      expect(res.status).toBe(200),
    );

    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/billing/mock-pay`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/billing/checkout`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/billing/downgrade`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .expect(403);

    // Viewing the plan is still allowed for any member.
    await request(app.getHttpServer())
      .get(`/api/workspaces/${workspaceId}/billing`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .expect(200);
  });

  it('9. webhook delivery is idempotent for a duplicate eventId', async () => {
    expect(WEBHOOK_SECRET).not.toBe('');
    const owner = await register(emailFor('billing-webhook-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Billing Webhook WS',
    );

    const eventId = `evt-${workspaceId}`;
    const send = () =>
      request(app.getHttpServer())
        .post('/api/billing/webhook')
        .set('x-billing-webhook-secret', WEBHOOK_SECRET)
        .send({
          eventId,
          workspaceId,
          type: 'checkout.completed',
          plan: 'pro',
        });

    await send().expect(200);
    const firstPeriodEnd = (await getBilling(owner.accessToken, workspaceId))
      .currentPeriodEnd;

    await send().expect(200); // duplicate delivery of the same eventId
    const secondPeriodEnd = (await getBilling(owner.accessToken, workspaceId))
      .currentPeriodEnd;

    expect(firstPeriodEnd).not.toBeNull();
    expect(secondPeriodEnd).toBe(firstPeriodEnd); // not re-applied

    // Wrong shared secret is rejected outright.
    await request(app.getHttpServer())
      .post('/api/billing/webhook')
      .set('x-billing-webhook-secret', 'wrong-secret')
      .send({
        eventId: 'evt-bad',
        workspaceId,
        type: 'checkout.completed',
        plan: 'pro',
      })
      .expect(401);
  });

  it('10. a FREE workspace can create documents below the limit', async () => {
    const owner = await register(emailFor('limits-below-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Limits Below WS',
    );

    await createDocuments(owner.accessToken, workspaceId, 10, 'Doc');

    const billing = await getBilling(owner.accessToken, workspaceId);
    expect(billing.documents.used).toBe(10);
    expect(billing.documents.limit).toBe(50);
  });

  it('11. crossing the FREE document limit is rejected with a structured error', async () => {
    const owner = await register(emailFor('limits-cross-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Limits Cross WS',
    );

    // 50 is the FREE limit - fill it exactly.
    await createDocuments(owner.accessToken, workspaceId, 50, 'Doc');

    const res = await createDocument(
      owner.accessToken,
      workspaceId,
      'One too many',
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT_EXCEEDED',
      limitType: 'documents',
      limit: 50,
      plan: 'free',
    });
  });

  it('12. a PRO workspace receives a higher/unlimited document allowance', async () => {
    const owner = await register(emailFor('limits-pro-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Limits PRO WS',
    );
    await createDocuments(owner.accessToken, workspaceId, 50, 'Doc');

    // Blocked on FREE at exactly the limit.
    await createDocument(owner.accessToken, workspaceId, 'Blocked').then(
      (res) => expect(res.status).toBe(403),
    );

    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/billing/mock-pay`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(201);

    // The exact same request that was rejected on FREE now succeeds on PRO.
    await createDocument(owner.accessToken, workspaceId, 'Allowed on PRO').then(
      (res) => expect(res.status).toBe(201),
    );
  });

  it('13. a direct API call cannot bypass the member invitation limit', async () => {
    const owner = await register(emailFor('limits-member-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Limits Member WS',
    );

    // FREE maxMembers is 5, and the owner already occupies one slot -
    // invite + accept 4 more members to reach exactly 5.
    for (let i = 0; i < 4; i++) {
      const email = emailFor(`limits-member-${i}`);
      const member = await register(email, `Member${i}`);
      const inviteToken = await invite(
        owner.accessToken,
        workspaceId,
        email,
        'VIEWER',
      );
      await acceptInvite(member.accessToken, inviteToken).then((res) =>
        expect(res.status).toBe(200),
      );
    }

    const billing = await getBilling(owner.accessToken, workspaceId);
    expect(billing.members.used).toBe(5);

    // A 6th member's direct accept call is rejected server-side, even
    // though the invitation itself was already created.
    const sixthEmail = emailFor('limits-member-6th');
    const sixth = await register(sixthEmail, 'Sixth');
    const sixthInviteToken = await invite(
      owner.accessToken,
      workspaceId,
      sixthEmail,
      'VIEWER',
    );
    const res = await acceptInvite(sixth.accessToken, sixthInviteToken);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT_EXCEEDED',
      limitType: 'members',
      limit: 5,
      plan: 'free',
    });
  });

  it('14. downgrading to FREE never deletes existing data, only blocks new creation over the limit', async () => {
    const owner = await register(emailFor('limits-downgrade-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Limits Downgrade WS',
    );

    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/billing/mock-pay`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(201);

    // Create more documents than the FREE limit allows, while on PRO.
    const ids = await createDocuments(
      owner.accessToken,
      workspaceId,
      55,
      'Doc',
    );

    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/billing/downgrade`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(201);

    const billing = await getBilling(owner.accessToken, workspaceId);
    expect(billing.plan).toBe('free');
    expect(billing.documents.used).toBe(55); // nothing was deleted

    // Every pre-existing document remains readable.
    const list = await request(app.getHttpServer())
      .get(`/api/workspaces/${workspaceId}/documents`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect((list.body as { id: string }[]).map((d) => d.id)).toEqual(
      expect.arrayContaining(ids),
    );

    // But creating a new document is blocked until back under the limit.
    const res = await createDocument(
      owner.accessToken,
      workspaceId,
      'Over limit',
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED' });
  });

  it('15. concurrent requests at the hard document limit do not both succeed', async () => {
    const owner = await register(emailFor('limits-concurrent-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Limits Concurrent WS',
    );

    // One slot left (49 of 50).
    await createDocuments(owner.accessToken, workspaceId, 49, 'Doc');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createDocument(owner.accessToken, workspaceId, `Racer ${i}`),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    // Exactly one request wins the last slot; the transactional
    // workspace-row lock in EntitlementsService.lockWorkspace serializes
    // the rest so they see the count already at the limit.
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 403)).toHaveLength(4);

    const billing = await getBilling(owner.accessToken, workspaceId);
    expect(billing.documents.used).toBe(50);
  });
});
