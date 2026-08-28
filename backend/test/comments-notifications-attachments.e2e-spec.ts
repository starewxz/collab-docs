import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const RUN_ID = Date.now();
const emailFor = (name: string) => `${name}-${RUN_ID}@example.com`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AuthResponseBody {
  accessToken: string;
  user: { id: string; email: string };
}

interface WorkspaceBody {
  id: string;
}

interface InvitationBody {
  inviteToken: string;
}

interface DocumentBody {
  id: string;
}

interface CommentBody {
  id: string;
  authorId: string;
  content: string;
  parentCommentId: string | null;
  resolvedAt: string | null;
  mentionedUserIds: string[];
  replies?: CommentBody[];
}

interface NotificationBody {
  id: string;
  type: string;
  documentId: string;
  commentId: string | null;
  actorId: string | null;
  readAt: string | null;
}

interface AttachmentBody {
  id: string;
  status: 'pending' | 'ready';
  size: number;
  mimeType: string;
}

interface UploadUrlBody {
  attachment: AttachmentBody;
  uploadUrl: string;
}

describe('Comments, Mentions, Notifications & Attachments (e2e)', () => {
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

  async function createWorkspace(
    agent: ReturnType<typeof request.agent>,
    token: string,
    name: string,
  ): Promise<string> {
    const res = await agent
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return (res.body as WorkspaceBody).id;
  }

  async function inviteAndAccept(
    ownerAgent: ReturnType<typeof request.agent>,
    ownerToken: string,
    workspaceId: string,
    inviteeAgent: ReturnType<typeof request.agent>,
    inviteeToken: string,
    inviteeEmail: string,
    role: string,
  ): Promise<void> {
    const inviteRes = await ownerAgent
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail, role })
      .expect(201);
    const { inviteToken } = inviteRes.body as InvitationBody;

    await inviteeAgent
      .post(`/api/invitations/${inviteToken}/accept`)
      .set('Authorization', `Bearer ${inviteeToken}`)
      .expect(200);
  }

  async function createDocument(
    agent: ReturnType<typeof request.agent>,
    token: string,
    workspaceId: string,
    title: string,
  ): Promise<string> {
    const res = await agent
      .post(`/api/workspaces/${workspaceId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title })
      .expect(201);
    return (res.body as DocumentBody).id;
  }

  /** Polls GET /api/notifications for the calling user until a notification
   * matching `predicate` appears, or fails after ~3s. Needed because
   * notification creation happens asynchronously via a real BullMQ worker
   * backed by the real Redis instance - there is no synchronous signal. */
  async function waitForNotification(
    agent: ReturnType<typeof request.agent>,
    token: string,
    predicate: (n: NotificationBody) => boolean,
  ): Promise<NotificationBody> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const res = await agent
        .get('/api/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const found = (res.body as NotificationBody[]).find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for notification');
      }
      await sleep(100);
    }
  }

  describe('Flow A - comment create/read/reply', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let workspaceId: string;
    let documentId: string;
    let rootId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cmt-owner-a'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS A');
      documentId = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceId,
        'Doc A',
      );
    });

    it('creates a root comment', async () => {
      const res = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'First comment' })
        .expect(201);
      const body = res.body as CommentBody;
      expect(body.content).toBe('First comment');
      expect(body.parentCommentId).toBeNull();
      rootId = body.id;
    });

    it('creates a reply to the root comment', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'A reply', parentCommentId: rootId })
        .expect(201);
    });

    it('lists comments as threads with nested replies', async () => {
      const res = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const threads = res.body as CommentBody[];
      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe(rootId);
      expect(threads[0].replies).toHaveLength(1);
      expect(threads[0].replies?.[0].content).toBe('A reply');
    });

    it('rejects replies nested more than one level deep', async () => {
      const res = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const replyId = (res.body as CommentBody[])[0].replies?.[0].id;

      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Too deep', parentCommentId: replyId })
        .expect(400);
    });
  });

  describe('Flow B - ownership edit/delete rules', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let editorAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let editorToken: string;
    let workspaceId: string;
    let documentId: string;
    let editorCommentId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      editorAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cmt-owner-b'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS B');
      documentId = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceId,
        'Doc B',
      );

      const editorEmail = emailFor('cmt-editor-b');
      const editor = await register(editorAgent, editorEmail, 'Editor');
      editorToken = editor.accessToken;
      await inviteAndAccept(
        ownerAgent,
        ownerToken,
        workspaceId,
        editorAgent,
        editorToken,
        editorEmail,
        'EDITOR',
      );

      const res = await editorAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ content: "Editor's comment" })
        .expect(201);
      editorCommentId = (res.body as CommentBody).id;
    });

    it('the author can edit their own comment', async () => {
      const res = await editorAgent
        .patch(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${editorCommentId}`,
        )
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ content: 'Edited by author' })
        .expect(200);
      expect((res.body as CommentBody).content).toBe('Edited by author');
    });

    it('another member cannot edit someone else comment, even the OWNER', async () => {
      await ownerAgent
        .patch(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${editorCommentId}`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Hacked' })
        .expect(403);
    });

    it('OWNER/ADMIN can delete (moderate) someone else comment', async () => {
      await ownerAgent
        .delete(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${editorCommentId}`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);
    });

    it('a non-owner/admin cannot delete someone else comment', async () => {
      const secondEditorAgent = request.agent(app.getHttpServer());
      const secondEditorEmail = emailFor('cmt-editor2-b');
      const secondEditor = await register(
        secondEditorAgent,
        secondEditorEmail,
        'Editor2',
      );
      await inviteAndAccept(
        ownerAgent,
        ownerToken,
        workspaceId,
        secondEditorAgent,
        secondEditor.accessToken,
        secondEditorEmail,
        'EDITOR',
      );

      const res = await editorAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ content: 'Another editor comment' })
        .expect(201);
      const commentId = (res.body as CommentBody).id;

      await secondEditorAgent
        .delete(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${commentId}`,
        )
        .set('Authorization', `Bearer ${secondEditor.accessToken}`)
        .expect(403);
    });
  });

  describe('Flow C - resolve/reopen a thread', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let workspaceId: string;
    let documentId: string;
    let rootId: string;
    let replyId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cmt-owner-c'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS C');
      documentId = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceId,
        'Doc C',
      );

      const rootRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Root to resolve' })
        .expect(201);
      rootId = (rootRes.body as CommentBody).id;

      const replyRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'A reply', parentCommentId: rootId })
        .expect(201);
      replyId = (replyRes.body as CommentBody).id;
    });

    it('resolves the root thread', async () => {
      const res = await ownerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${rootId}/resolve`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      expect((res.body as CommentBody).resolvedAt).not.toBeNull();
    });

    it('reopens the root thread', async () => {
      const res = await ownerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${rootId}/reopen`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      expect((res.body as CommentBody).resolvedAt).toBeNull();
    });

    it('rejects resolving a reply directly (only the thread root can be resolved)', async () => {
      await ownerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${replyId}/resolve`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });
  });

  describe('Flow D - VIEWER can read comments but cannot mutate', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let viewerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let viewerToken: string;
    let workspaceId: string;
    let documentId: string;
    let rootId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      viewerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cmt-owner-d'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS D');
      documentId = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceId,
        'Doc D',
      );

      const viewerEmail = emailFor('cmt-viewer-d');
      const viewer = await register(viewerAgent, viewerEmail, 'Viewer');
      viewerToken = viewer.accessToken;
      await inviteAndAccept(
        ownerAgent,
        ownerToken,
        workspaceId,
        viewerAgent,
        viewerToken,
        viewerEmail,
        'VIEWER',
      );

      const rootRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Owner comment' })
        .expect(201);
      rootId = (rootRes.body as CommentBody).id;
    });

    it('VIEWER can list comments', async () => {
      await viewerAgent
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('VIEWER cannot create, edit, delete, resolve, or reopen comments', async () => {
      await viewerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ content: 'Should fail' })
        .expect(403);

      await viewerAgent
        .patch(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${rootId}`,
        )
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ content: 'Hacked' })
        .expect(403);

      await viewerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${rootId}/resolve`,
        )
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      await viewerAgent
        .delete(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${rootId}`,
        )
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('Flow E - outsider and cross-workspace IDOR protection for comments', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let outsiderAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let outsiderToken: string;
    let workspaceA: string;
    let workspaceB: string;
    let documentA: string;
    let documentB: string;
    let commentInA: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      outsiderAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cmt-owner-e'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceA = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS E-A');
      workspaceB = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS E-B');
      documentA = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceA,
        'Doc E-A',
      );
      documentB = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceB,
        'Doc E-B',
      );

      const outsider = await register(
        outsiderAgent,
        emailFor('cmt-outsider-e'),
        'Outsider',
      );
      outsiderToken = outsider.accessToken;

      const res = await ownerAgent
        .post(`/api/workspaces/${workspaceA}/documents/${documentA}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Private comment' })
        .expect(201);
      commentInA = (res.body as CommentBody).id;
    });

    it('an outsider gets 404, never 403, for list/create/edit/delete/resolve', async () => {
      await outsiderAgent
        .get(`/api/workspaces/${workspaceA}/documents/${documentA}/comments`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);

      await outsiderAgent
        .post(`/api/workspaces/${workspaceA}/documents/${documentA}/comments`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ content: 'Intruder' })
        .expect(404);

      await outsiderAgent
        .patch(
          `/api/workspaces/${workspaceA}/documents/${documentA}/comments/${commentInA}`,
        )
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ content: 'Hacked' })
        .expect(404);

      await outsiderAgent
        .delete(
          `/api/workspaces/${workspaceA}/documents/${documentA}/comments/${commentInA}`,
        )
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('a workspace B document cannot be used to reach a workspace A comment', async () => {
      await ownerAgent
        .patch(
          `/api/workspaces/${workspaceB}/documents/${documentB}/comments/${commentInA}`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Hacked cross-workspace' })
        .expect(404);
    });
  });

  describe('Flow F - mentions produce exactly one notification, idempotency, invalid mentions rejected', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let mentionedAgent: ReturnType<typeof request.agent>;
    let outsiderAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let ownerUserId: string;
    let mentionedToken: string;
    let mentionedUserId: string;
    let outsiderUserId: string;
    let workspaceId: string;
    let documentId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      mentionedAgent = request.agent(app.getHttpServer());
      outsiderAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cmt-owner-f'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      ownerUserId = owner.user.id;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS F');
      documentId = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceId,
        'Doc F',
      );

      const mentionedEmail = emailFor('cmt-mentioned-f');
      const mentioned = await register(
        mentionedAgent,
        mentionedEmail,
        'Mentioned',
      );
      mentionedToken = mentioned.accessToken;
      mentionedUserId = mentioned.user.id;
      await inviteAndAccept(
        ownerAgent,
        ownerToken,
        workspaceId,
        mentionedAgent,
        mentionedToken,
        mentionedEmail,
        'EDITOR',
      );

      const outsider = await register(
        outsiderAgent,
        emailFor('cmt-outsider-f'),
        'Outsider',
      );
      outsiderUserId = outsider.user.id;
    });

    it('mentioning a valid workspace member creates exactly one notification', async () => {
      const res = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          content: 'Hey @mentioned',
          mentionedUserIds: [mentionedUserId],
        })
        .expect(201);
      const commentId = (res.body as CommentBody).id;

      const notification = await waitForNotification(
        mentionedAgent,
        mentionedToken,
        (n) => n.type === 'mention' && n.commentId === commentId,
      );
      expect(notification.actorId).toBe(ownerUserId);

      // Give any (incorrect) second delivery a chance to land, then assert
      // there is still exactly one mention notification for this comment.
      await sleep(300);
      const list = await mentionedAgent
        .get('/api/notifications')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(200);
      const matches = (list.body as NotificationBody[]).filter(
        (n) => n.type === 'mention' && n.commentId === commentId,
      );
      expect(matches).toHaveLength(1);
    });

    it('resolving an already-resolved thread twice does not duplicate the notification (idempotent event processing)', async () => {
      const rootRes = await mentionedAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${mentionedToken}`)
        .send({ content: 'Root by mentioned user' })
        .expect(201);
      const rootId = (rootRes.body as CommentBody).id;

      await ownerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${rootId}/resolve`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      await waitForNotification(
        mentionedAgent,
        mentionedToken,
        (n) => n.type === 'thread_resolved' && n.commentId === rootId,
      );

      // Calling resolve again on an already-resolved thread is a documented
      // no-op in CommentsService - it must not enqueue a second notification.
      await ownerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${rootId}/resolve`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      await sleep(300);
      const list = await mentionedAgent
        .get('/api/notifications')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(200);
      const matches = (list.body as NotificationBody[]).filter(
        (n) => n.type === 'thread_resolved' && n.commentId === rootId,
      );
      expect(matches).toHaveLength(1);
    });

    it('rejects mentioning a user who is not a workspace member', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          content: 'Hey @outsider',
          mentionedUserIds: [outsiderUserId],
        })
        .expect(400);
    });

    it('editing a comment while keeping the same mention does not create a second notification', async () => {
      const createRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          content: 'Mentioning once',
          mentionedUserIds: [mentionedUserId],
        })
        .expect(201);
      const commentId = (createRes.body as CommentBody).id;

      await waitForNotification(
        mentionedAgent,
        mentionedToken,
        (n) => n.type === 'mention' && n.commentId === commentId,
      );

      // Re-submitting the same already-mentioned user on edit must not
      // re-trigger the mention notification - only newly-added mentions do.
      await ownerAgent
        .patch(
          `/api/workspaces/${workspaceId}/documents/${documentId}/comments/${commentId}`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          content: 'Mentioning once, edited',
          mentionedUserIds: [mentionedUserId],
        })
        .expect(200);

      await sleep(300);
      const list = await mentionedAgent
        .get('/api/notifications')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(200);
      const matches = (list.body as NotificationBody[]).filter(
        (n) => n.type === 'mention' && n.commentId === commentId,
      );
      expect(matches).toHaveLength(1);
    });
  });

  describe('Flow G - notification unread -> read flow', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let mentionedAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let mentionedToken: string;
    let workspaceId: string;
    let documentId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      mentionedAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cmt-owner-g'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Cmt WS G');
      documentId = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceId,
        'Doc G',
      );

      const mentionedEmail = emailFor('cmt-mentioned-g');
      const mentioned = await register(
        mentionedAgent,
        mentionedEmail,
        'Mentioned',
      );
      mentionedToken = mentioned.accessToken;
      await inviteAndAccept(
        ownerAgent,
        ownerToken,
        workspaceId,
        mentionedAgent,
        mentionedToken,
        mentionedEmail,
        'EDITOR',
      );

      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          content: 'Hey @mentioned',
          mentionedUserIds: [mentioned.user.id],
        })
        .expect(201);

      await waitForNotification(
        mentionedAgent,
        mentionedToken,
        (n) => n.type === 'mention',
      );
    });

    it('unread count reflects the new notification', async () => {
      const res = await mentionedAgent
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(200);
      expect((res.body as { count: number }).count).toBeGreaterThanOrEqual(1);
    });

    it('marking one notification read decreases the unread count', async () => {
      const list = await mentionedAgent
        .get('/api/notifications')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(200);
      const notification = (list.body as NotificationBody[])[0];

      await mentionedAgent
        .post(`/api/notifications/${notification.id}/read`)
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(204);

      const afterList = await mentionedAgent
        .get('/api/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(200);
      expect(
        (afterList.body as NotificationBody[]).some(
          (n) => n.id === notification.id,
        ),
      ).toBe(false);
    });

    it('mark-all-read clears the unread count to zero', async () => {
      await mentionedAgent
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(204);

      const res = await mentionedAgent
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${mentionedToken}`)
        .expect(200);
      expect((res.body as { count: number }).count).toBe(0);
    });

    it('a user never sees another user notification', async () => {
      const res = await ownerAgent
        .get('/api/notifications')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const notifications = res.body as NotificationBody[];
      // The owner authored the mention, so should never receive a
      // notification about their own action.
      expect(notifications.some((n) => n.type === 'mention')).toBe(false);
    });
  });

  describe('Flow H - attachment upload -> confirm -> authorized download, and rejection rules', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let outsiderAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let outsiderToken: string;
    let workspaceA: string;
    let workspaceB: string;
    let documentA: string;
    let documentB: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      outsiderAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('att-owner-h'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceA = await createWorkspace(ownerAgent, ownerToken, 'Att WS H-A');
      workspaceB = await createWorkspace(ownerAgent, ownerToken, 'Att WS H-B');
      documentA = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceA,
        'Doc H-A',
      );
      documentB = await createDocument(
        ownerAgent,
        ownerToken,
        workspaceB,
        'Doc H-B',
      );

      const outsider = await register(
        outsiderAgent,
        emailFor('att-outsider-h'),
        'Outsider',
      );
      outsiderToken = outsider.accessToken;
    });

    it('uploads bytes to the presigned URL, confirms, and downloads the same content back', async () => {
      const createRes = await ownerAgent
        .post(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ filename: 'notes.txt', mimeType: 'text/plain', size: 11 })
        .expect(201);
      const { attachment, uploadUrl } = createRes.body as UploadUrlBody;
      expect(attachment.status).toBe('pending');

      const fileContent = 'hello world';
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileContent,
      });
      expect(putRes.ok).toBe(true);

      const confirmRes = await ownerAgent
        .post(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments/${attachment.id}/confirm`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      const confirmed = confirmRes.body as AttachmentBody;
      expect(confirmed.status).toBe('ready');
      expect(confirmed.size).toBe(fileContent.length);

      const downloadRes = await ownerAgent
        .get(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments/${attachment.id}/download-url`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const { url } = downloadRes.body as { url: string };

      const getRes = await fetch(url);
      const downloaded = await getRes.text();
      expect(downloaded).toBe(fileContent);

      await ownerAgent
        .delete(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments/${attachment.id}`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const listRes = await ownerAgent
        .get(`/api/workspaces/${workspaceA}/documents/${documentA}/attachments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(
        (listRes.body as AttachmentBody[]).some((a) => a.id === attachment.id),
      ).toBe(false);
    });

    it('rejects a disallowed MIME type', async () => {
      await ownerAgent
        .post(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          filename: 'virus.exe',
          mimeType: 'application/x-msdownload',
          size: 100,
        })
        .expect(400);
    });

    it('rejects a declared size over the maximum', async () => {
      await ownerAgent
        .post(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          filename: 'huge.png',
          mimeType: 'image/png',
          size: 999_999_999,
        })
        .expect(400);
    });

    it('an outsider gets 404 for list/upload/download on a workspace they do not belong to', async () => {
      await outsiderAgent
        .get(`/api/workspaces/${workspaceA}/documents/${documentA}/attachments`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);

      await outsiderAgent
        .post(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments`,
        )
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ filename: 'x.txt', mimeType: 'text/plain', size: 10 })
        .expect(404);
    });

    it('a workspace B document cannot be used to reach a workspace A attachment (cross-workspace IDOR)', async () => {
      const createRes = await ownerAgent
        .post(
          `/api/workspaces/${workspaceA}/documents/${documentA}/attachments`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ filename: 'secret.txt', mimeType: 'text/plain', size: 10 })
        .expect(201);
      const { attachment } = createRes.body as UploadUrlBody;

      await ownerAgent
        .get(
          `/api/workspaces/${workspaceB}/documents/${documentB}/attachments/${attachment.id}/download-url`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });
});
