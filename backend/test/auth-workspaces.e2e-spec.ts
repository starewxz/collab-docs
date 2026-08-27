import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const RUN_ID = Date.now();
const emailFor = (name: string) => `${name}-${RUN_ID}@example.com`;

function extractRefreshCookie(res: {
  headers: Record<string, unknown>;
}): string {
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const refreshCookie = cookies.find(
    (c): c is string => typeof c === 'string' && c.startsWith('refresh_token='),
  );
  if (!refreshCookie) {
    throw new Error('No refresh_token cookie in response');
  }
  return refreshCookie.split(';')[0];
}

interface AuthResponseBody {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string };
}

interface WorkspaceBody {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface InvitationBody {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  status: string;
  inviteToken?: string;
}

interface MemberBody {
  id: string;
  userId: string;
  email: string;
  role: string;
}

describe('Auth + Workspaces (e2e)', () => {
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
    agent: ReturnType<typeof request.agent>,
    email: string,
    firstName: string,
  ): Promise<AuthResponseBody> {
    const res = await agent
      .post('/api/auth/register')
      .send({ email, password: 'password123', firstName, lastName: 'Test' })
      .expect(201);
    return res.body as AuthResponseBody;
  }

  describe('Flow A - auth lifecycle', () => {
    it('register -> login -> me -> refresh -> old refresh rejected -> logout -> refresh rejected', async () => {
      const agent = request.agent(app.getHttpServer());
      const email = emailFor('flow-a');

      await register(agent, email, 'FlowA');

      const loginRes = await agent
        .post('/api/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      const { accessToken } = loginRes.body as AuthResponseBody;
      const cookieBeforeRefresh = extractRefreshCookie(loginRes);

      const meRes = await agent
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect((meRes.body as { email: string }).email).toBe(email);
      expect(meRes.body).not.toHaveProperty('passwordHash');

      const refreshRes = await agent.post('/api/auth/refresh').expect(200);
      expect((refreshRes.body as AuthResponseBody).accessToken).toBeDefined();

      // Replay the pre-rotation cookie value directly (bypassing the
      // agent's jar, which has already moved on to the rotated cookie) -
      // it must now be rejected.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookieBeforeRefresh)
        .expect(401);

      await agent.post('/api/auth/logout').expect(200);
      await agent.post('/api/auth/refresh').expect(401);
    });
  });

  describe('Flows B-F - workspaces, invitations, security', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let viewerAgent: ReturnType<typeof request.agent>;
    let outsiderAgent: ReturnType<typeof request.agent>;

    beforeAll(() => {
      ownerAgent = request.agent(app.getHttpServer());
      viewerAgent = request.agent(app.getHttpServer());
      outsiderAgent = request.agent(app.getHttpServer());
    });

    let ownerToken: string;
    let viewerToken: string;
    let outsiderToken: string;
    let workspaceId: string;
    let inviteToken: string;
    let viewerMemberId: string;
    let ownerMemberId: string;

    it('Flow B: owner creates a workspace and becomes OWNER', async () => {
      const owner = await register(ownerAgent, emailFor('owner'), 'Owner');
      ownerToken = owner.accessToken;

      const res = await ownerAgent
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'E2E Workspace' })
        .expect(201);
      const workspace = res.body as WorkspaceBody;
      expect(workspace.role).toBe('OWNER');
      workspaceId = workspace.id;

      await ownerAgent
        .get(`/api/workspaces/${workspaceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });

    it('Flow C: owner invites a viewer, who sees and accepts the invitation', async () => {
      const viewerEmail = emailFor('viewer');
      const viewer = await register(viewerAgent, viewerEmail, 'Viewer');
      viewerToken = viewer.accessToken;

      const inviteRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: viewerEmail, role: 'VIEWER' })
        .expect(201);
      const invitation = inviteRes.body as InvitationBody;
      expect(invitation.inviteToken).toBeDefined();
      inviteToken = invitation.inviteToken!;

      const mine = await viewerAgent
        .get('/api/invitations/me')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      expect(
        (mine.body as InvitationBody[]).some((i) => i.id === invitation.id),
      ).toBe(true);

      await viewerAgent
        .post(`/api/invitations/${inviteToken}/accept`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const workspaces = await viewerAgent
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      expect(
        (workspaces.body as WorkspaceBody[]).some((w) => w.id === workspaceId),
      ).toBe(true);

      const members = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const memberList = members.body as MemberBody[];
      viewerMemberId = memberList.find((m) => m.email === viewerEmail)!.id;
      ownerMemberId = memberList.find((m) => m.role === 'OWNER')!.id;
      expect(viewerMemberId).toBeDefined();
    });

    it('Flow D: a VIEWER can read but cannot manage membership', async () => {
      await viewerAgent
        .get(`/api/workspaces/${workspaceId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      await viewerAgent
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ email: emailFor('nobody'), role: 'VIEWER' })
        .expect(403);

      await viewerAgent
        .patch(`/api/workspaces/${workspaceId}/members/${viewerMemberId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ role: 'ADMIN' })
        .expect(403);

      await viewerAgent
        .delete(`/api/workspaces/${workspaceId}/members/${viewerMemberId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });

    it('Flow E: an outsider gets 404, never 403, for a workspace they are not in', async () => {
      const outsider = await register(
        outsiderAgent,
        emailFor('outsider'),
        'Outsider',
      );
      outsiderToken = outsider.accessToken;

      await outsiderAgent
        .get(`/api/workspaces/${workspaceId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);

      await outsiderAgent
        .get(`/api/workspaces/${workspaceId}/members`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);

      await outsiderAgent
        .patch(`/api/workspaces/${workspaceId}/members/${viewerMemberId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ role: 'ADMIN' })
        .expect(404);
    });

    it('Flow F: an ADMIN cannot remove or demote the OWNER', async () => {
      await ownerAgent
        .patch(`/api/workspaces/${workspaceId}/members/${viewerMemberId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'ADMIN' })
        .expect(200);

      // Promotion takes effect immediately - same viewer JWT, new behavior.
      await viewerAgent
        .delete(`/api/workspaces/${workspaceId}/members/${ownerMemberId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      await viewerAgent
        .patch(`/api/workspaces/${workspaceId}/members/${ownerMemberId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ role: 'VIEWER' })
        .expect(403);
    });

    it('exhausting the login rate limit does not throttle unrelated workspace routes', async () => {
      const attackerEmail = emailFor('rate-limit-target');
      await register(
        request.agent(app.getHttpServer()),
        attackerEmail,
        'Target',
      );

      const attempts = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(app.getHttpServer())
            .post('/api/auth/login')
            .send({ email: attackerEmail, password: 'wrong-password' }),
        ),
      );
      expect(attempts.some((res) => res.status === 429)).toBe(true);

      // The still-valid, already-issued owner token must keep working on a
      // completely unrelated route while login is being throttled.
      await ownerAgent
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('Flow G - concurrent invitation acceptance', () => {
    it('exactly one of two simultaneous accepts succeeds in creating the membership', async () => {
      const ownerAgent = request.agent(app.getHttpServer());
      const inviteeAgent = request.agent(app.getHttpServer());

      const owner = await register(
        ownerAgent,
        emailFor('concurrent-owner'),
        'Owner',
      );
      const inviteeEmail = emailFor('concurrent-invitee');
      const invitee = await register(inviteeAgent, inviteeEmail, 'Invitee');

      const workspaceRes = await ownerAgent
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Concurrency Workspace' })
        .expect(201);
      const workspaceId = (workspaceRes.body as WorkspaceBody).id;

      const inviteRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: inviteeEmail, role: 'VIEWER' })
        .expect(201);
      const token = (inviteRes.body as InvitationBody).inviteToken!;

      const inviteeToken = invitee.accessToken;

      const [first, second] = await Promise.all([
        inviteeAgent
          .post(`/api/invitations/${token}/accept`)
          .set('Authorization', `Bearer ${inviteeToken}`),
        inviteeAgent
          .post(`/api/invitations/${token}/accept`)
          .set('Authorization', `Bearer ${inviteeToken}`),
      ]);

      const statuses = [first.status, second.status].sort();
      // Both may report 200 (the row-lock serializes them and the second
      // sees "already a member" as a no-op success) or one may see a 409 -
      // what must never happen is neither request succeeding, or two rows.
      expect(statuses[0]).toBe(200);
      expect([200, 409]).toContain(statuses[1]);

      const members = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      const matching = (members.body as MemberBody[]).filter(
        (m) => m.email === inviteeEmail,
      );
      expect(matching).toHaveLength(1);
    });
  });
});
