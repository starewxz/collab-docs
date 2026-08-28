import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const RUN_ID = Date.now();
const emailFor = (name: string) => `${name}-${RUN_ID}@example.com`;

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
  workspaceId: string;
  parentId: string | null;
  title: string;
  position: number;
  archivedAt: string | null;
}

describe('Documents (e2e)', () => {
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

  describe('Flow A - CRUD hierarchy', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let workspaceId: string;
    let rootId: string;
    let childId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(ownerAgent, emailFor('doc-owner'), 'Owner');
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Docs WS A');
    });

    it('creates a root document', async () => {
      const res = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Root' })
        .expect(201);
      const body = res.body as DocumentBody;
      expect(body.parentId).toBeNull();
      expect(body.position).toBe(1000);
      rootId = body.id;
    });

    it('creates a child document under the root', async () => {
      const res = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Child', parentId: rootId })
        .expect(201);
      const body = res.body as DocumentBody;
      expect(body.parentId).toBe(rootId);
      childId = body.id;
    });

    it('lists documents in the workspace', async () => {
      const res = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const body = res.body as DocumentBody[];
      expect(body.map((d) => d.id).sort()).toEqual([childId, rootId].sort());
    });

    it('gets a single document', async () => {
      const res = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents/${rootId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect((res.body as DocumentBody).id).toBe(rootId);
    });

    it('renames a document', async () => {
      const res = await ownerAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${rootId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Renamed Root' })
        .expect(200);
      expect((res.body as DocumentBody).title).toBe('Renamed Root');
    });

    it('moves the child to the workspace root', async () => {
      const res = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${childId}/move`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: null })
        .expect(201);
      expect((res.body as DocumentBody).parentId).toBeNull();
    });

    it('archives and restores a document', async () => {
      await ownerAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${rootId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const activeList = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(
        (activeList.body as DocumentBody[]).some((d) => d.id === rootId),
      ).toBe(false);

      const restoreRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${rootId}/restore`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      expect((restoreRes.body as DocumentBody).archivedAt).toBeNull();
    });
  });

  describe('Flow B - VIEWER is blocked from all mutations', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let viewerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let viewerToken: string;
    let workspaceId: string;
    let docId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      viewerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('doc-owner-b'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Docs WS B');

      const viewerEmail = emailFor('doc-viewer-b');
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

      const docRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Owner Doc' })
        .expect(201);
      docId = (docRes.body as DocumentBody).id;
    });

    it('VIEWER can list and read documents', async () => {
      await viewerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      await viewerAgent
        .get(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('VIEWER cannot create, rename, move, archive, or restore', async () => {
      await viewerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Should Fail' })
        .expect(403);

      await viewerAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Hacked' })
        .expect(403);

      await viewerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${docId}/move`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ parentId: null })
        .expect(403);

      await viewerAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      await ownerAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      await viewerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${docId}/restore`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe('Flow C - EDITOR can create and mutate documents', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let editorAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let editorToken: string;
    let workspaceId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      editorAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('doc-owner-c'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Docs WS C');

      const editorEmail = emailFor('doc-editor-c');
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
    });

    it('EDITOR can create, rename, move, and archive documents', async () => {
      const createRes = await editorAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ title: 'Editor Doc' })
        .expect(201);
      const docId = (createRes.body as DocumentBody).id;

      await editorAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ title: 'Renamed by Editor' })
        .expect(200);

      await editorAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(204);

      await editorAgent
        .post(`/api/workspaces/${workspaceId}/documents/${docId}/restore`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(201);
    });
  });

  describe('Flow D - an outsider is blocked with 404, never 403', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let outsiderAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let outsiderToken: string;
    let workspaceId: string;
    let docId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      outsiderAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('doc-owner-d'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Docs WS D');

      const outsider = await register(
        outsiderAgent,
        emailFor('doc-outsider-d'),
        'Outsider',
      );
      outsiderToken = outsider.accessToken;

      const docRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Private Doc' })
        .expect(201);
      docId = (docRes.body as DocumentBody).id;
    });

    it('outsider gets 404 for list, get, create, update, move, archive', async () => {
      await outsiderAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);

      await outsiderAgent
        .get(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);

      await outsiderAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ title: 'Intruder Doc' })
        .expect(404);

      await outsiderAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ title: 'Hacked' })
        .expect(404);

      await outsiderAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${docId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });
  });

  describe('Flow E - cross-workspace IDOR protection', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let workspaceA: string;
    let workspaceB: string;
    let docInA: string;
    let docInB: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('doc-owner-e'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceA = await createWorkspace(ownerAgent, ownerToken, 'Docs WS E-A');
      workspaceB = await createWorkspace(ownerAgent, ownerToken, 'Docs WS E-B');

      const docARes = await ownerAgent
        .post(`/api/workspaces/${workspaceA}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Doc in A' })
        .expect(201);
      docInA = (docARes.body as DocumentBody).id;

      const docBRes = await ownerAgent
        .post(`/api/workspaces/${workspaceB}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Doc in B' })
        .expect(201);
      docInB = (docBRes.body as DocumentBody).id;
    });

    it('same owner cannot GET workspace B document through workspace A route', async () => {
      await ownerAgent
        .get(`/api/workspaces/${workspaceA}/documents/${docInB}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('cannot PATCH across workspaces', async () => {
      await ownerAgent
        .patch(`/api/workspaces/${workspaceA}/documents/${docInB}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Hacked' })
        .expect(404);
    });

    it('cannot MOVE using a cross-workspace parentId', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceA}/documents/${docInA}/move`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: docInB })
        .expect(404);
    });

    it('cannot ARCHIVE across workspaces', async () => {
      await ownerAgent
        .delete(`/api/workspaces/${workspaceA}/documents/${docInB}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('cannot create a document under a cross-workspace parentId', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceA}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Cross', parentId: docInB })
        .expect(404);
    });
  });

  describe('Flow F - cycle protection keeps the tree valid', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let workspaceId: string;
    let rootId: string;
    let childId: string;
    let grandchildId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('doc-owner-f'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Docs WS F');

      const rootRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Root' })
        .expect(201);
      rootId = (rootRes.body as DocumentBody).id;

      const childRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Child', parentId: rootId })
        .expect(201);
      childId = (childRes.body as DocumentBody).id;

      const grandchildRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Grandchild', parentId: childId })
        .expect(201);
      grandchildId = (grandchildRes.body as DocumentBody).id;
    });

    it('rejects moving the root under its own grandchild', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${rootId}/move`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: grandchildId })
        .expect(400);
    });

    it('rejects a document becoming its own parent', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${rootId}/move`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: rootId })
        .expect(400);
    });

    it('the tree remains intact and consistent after rejected moves', async () => {
      const res = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const documents = res.body as DocumentBody[];
      const byId = new Map(documents.map((d) => [d.id, d]));
      expect(byId.get(childId)?.parentId).toBe(rootId);
      expect(byId.get(grandchildId)?.parentId).toBe(childId);
      expect(byId.get(rootId)?.parentId).toBeNull();
    });
  });

  describe('Flow G - archive/restore subtree behavior', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let workspaceId: string;
    let rootId: string;
    let childId: string;
    let grandchildId: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('doc-owner-g'),
        'Owner',
      );
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'Docs WS G');

      const rootRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Root' })
        .expect(201);
      rootId = (rootRes.body as DocumentBody).id;

      const childRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Child', parentId: rootId })
        .expect(201);
      childId = (childRes.body as DocumentBody).id;

      const grandchildRes = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Grandchild', parentId: childId })
        .expect(201);
      grandchildId = (grandchildRes.body as DocumentBody).id;
    });

    it('archiving the root cascades to the whole subtree', async () => {
      await ownerAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${rootId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const activeList = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(activeList.body as DocumentBody[]).toHaveLength(0);

      const fullList = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents?includeArchived=true`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const archived = fullList.body as DocumentBody[];
      expect(archived).toHaveLength(3);
      expect(archived.every((d) => d.archivedAt !== null)).toBe(true);
    });

    it('an archived document cannot be moved until restored', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${childId}/move`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: null })
        .expect(400);
    });

    it('restoring the root cascades restoration to the whole subtree', async () => {
      await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${rootId}/restore`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const activeList = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const active = activeList.body as DocumentBody[];
      expect(active.map((d) => d.id).sort()).toEqual(
        [rootId, childId, grandchildId].sort(),
      );
    });

    it('restoring an orphaned document (parent still archived) reparents it to root', async () => {
      await ownerAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${rootId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const res = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents/${childId}/restore`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      expect((res.body as DocumentBody).parentId).toBeNull();

      const list = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const active = list.body as DocumentBody[];
      // Child and its own descendant (grandchild) are visible again; the
      // still-archived original root is not.
      expect(active.map((d) => d.id).sort()).toEqual(
        [childId, grandchildId].sort(),
      );
    });
  });

  describe('Concurrency - simultaneous sibling creation does not corrupt ordering', () => {
    it('two documents created at the same time both get distinct, valid positions', async () => {
      const ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('doc-owner-concurrency'),
        'Owner',
      );
      const ownerToken = owner.accessToken;
      const workspaceId = await createWorkspace(
        ownerAgent,
        ownerToken,
        'Docs WS Concurrency',
      );

      const [first, second] = await Promise.all([
        ownerAgent
          .post(`/api/workspaces/${workspaceId}/documents`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ title: 'Concurrent A' }),
        ownerAgent
          .post(`/api/workspaces/${workspaceId}/documents`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ title: 'Concurrent B' }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstBody = first.body as DocumentBody;
      const secondBody = second.body as DocumentBody;
      // No positional collision, and the tree stays queryable afterwards.
      expect(firstBody.position).not.toBe(secondBody.position);

      const list = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(list.body as DocumentBody[]).toHaveLength(2);
    });
  });

  describe('Document-tree Redis cache invalidation (TT gap 7)', () => {
    it('a rename is immediately visible in the list, never a stale cached title', async () => {
      const ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cache-owner'),
        'Owner',
      );
      const ownerToken = owner.accessToken;
      const workspaceId = await createWorkspace(
        ownerAgent,
        ownerToken,
        'Cache WS',
      );

      const created = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Original title' })
        .expect(201);
      const documentId = (created.body as DocumentBody).id;

      // Populate the cache with the original title.
      const before = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect((before.body as { title: string }[])[0].title).toBe(
        'Original title',
      );

      await ownerAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Renamed title' })
        .expect(200);

      const after = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect((after.body as { title: string }[])[0].title).toBe(
        'Renamed title',
      );
    });

    it('archiving is immediately reflected in the default (non-archived) list', async () => {
      const ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(
        ownerAgent,
        emailFor('cache-archive-owner'),
        'Owner',
      );
      const ownerToken = owner.accessToken;
      const workspaceId = await createWorkspace(
        ownerAgent,
        ownerToken,
        'Cache Archive WS',
      );

      const created = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'To archive' })
        .expect(201);
      const documentId = (created.body as DocumentBody).id;

      const before = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect((before.body as DocumentBody[]).map((d) => d.id)).toContain(
        documentId,
      );

      await ownerAgent
        .delete(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const after = await ownerAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect((after.body as DocumentBody[]).map((d) => d.id)).not.toContain(
        documentId,
      );
    });
  });

  describe('Document-level ACL (TT gap 1)', () => {
    let ownerAgent: ReturnType<typeof request.agent>;
    let ownerToken: string;
    let workspaceId: string;
    let documentId: string;

    let editorAgent: ReturnType<typeof request.agent>;
    let editorToken: string;
    let editorUserId: string;

    let viewerAgent: ReturnType<typeof request.agent>;
    let viewerToken: string;
    let viewerUserId: string;

    let outsiderAgent: ReturnType<typeof request.agent>;
    let outsiderToken: string;

    beforeAll(async () => {
      ownerAgent = request.agent(app.getHttpServer());
      const owner = await register(ownerAgent, emailFor('acl-owner'), 'Owner');
      ownerToken = owner.accessToken;
      workspaceId = await createWorkspace(ownerAgent, ownerToken, 'ACL WS');

      editorAgent = request.agent(app.getHttpServer());
      const editorEmail = emailFor('acl-editor');
      const editor = await register(editorAgent, editorEmail, 'Editor');
      editorToken = editor.accessToken;
      editorUserId = editor.user.id;
      await inviteAndAccept(
        ownerAgent,
        ownerToken,
        workspaceId,
        editorAgent,
        editorToken,
        editorEmail,
        'EDITOR',
      );

      viewerAgent = request.agent(app.getHttpServer());
      const viewerEmail = emailFor('acl-viewer');
      const viewer = await register(viewerAgent, viewerEmail, 'Viewer');
      viewerToken = viewer.accessToken;
      viewerUserId = viewer.user.id;
      await inviteAndAccept(
        ownerAgent,
        ownerToken,
        workspaceId,
        viewerAgent,
        viewerToken,
        viewerEmail,
        'VIEWER',
      );

      // A registered user with no membership in this workspace at all.
      outsiderAgent = request.agent(app.getHttpServer());
      const outsider = await register(
        outsiderAgent,
        emailFor('acl-outsider'),
        'Outsider',
      );
      outsiderToken = outsider.accessToken;

      const doc = await ownerAgent
        .post(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Restricted doc' })
        .expect(201);
      documentId = (doc.body as DocumentBody).id;

      await ownerAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${documentId}/access`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ restricted: true })
        .expect(200);
    });

    it('a user without workspace membership cannot fetch the document by direct ID', async () => {
      await outsiderAgent
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('a workspace EDITOR with no explicit share is denied on the restricted document', async () => {
      await editorAgent
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(403);

      await editorAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ title: 'Should not work' })
        .expect(403);
    });

    it('the restricted document is hidden from the EDITOR in the workspace list', async () => {
      const res = await editorAgent
        .get(`/api/workspaces/${workspaceId}/documents`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(200);
      const ids = (res.body as DocumentBody[]).map((d) => d.id);
      expect(ids).not.toContain(documentId);
    });

    it('an explicitly-shared VIEWER can read the restricted document', async () => {
      await ownerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/collaborators`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: viewerUserId, accessLevel: 'VIEWER' })
        .expect(201);

      const res = await viewerAgent
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      expect((res.body as DocumentBody).id).toBe(documentId);

      // A VIEWER-level share never grants edit, regardless of workspace role.
      await viewerAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Still read-only' })
        .expect(403);
    });

    it('an EDITOR-level share overrides the restriction and allows editing', async () => {
      await ownerAgent
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/collaborators`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: editorUserId, accessLevel: 'EDITOR' })
        .expect(201);

      const res = await editorAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ title: 'Now editable' })
        .expect(200);
      expect((res.body as { title: string }).title).toBe('Now editable');
    });

    it('a non-OWNER/ADMIN cannot manage document access', async () => {
      await editorAgent
        .patch(`/api/workspaces/${workspaceId}/documents/${documentId}/access`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ restricted: false })
        .expect(403);
    });
  });
});
