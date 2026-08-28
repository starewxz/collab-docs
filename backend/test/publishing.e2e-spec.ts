import type { AddressInfo } from 'net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';
import { CollaborationService } from '../src/modules/collaboration/collaboration.service';

const RUN_ID = Date.now();
const emailFor = (name: string) => `${name}-${RUN_ID}@example.com`;

interface AuthResponseBody {
  accessToken: string;
  user: { id: string; email: string };
}

interface WorkspaceBody {
  id: string;
}

interface DocumentBody {
  id: string;
  isPublished: boolean;
  publicSlug: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
}

interface InvitationBody {
  inviteToken: string;
}

interface JoinedPayload {
  documentId: string;
  canEdit: boolean;
  role: string;
  self: { id: string; name: string };
}

interface PublicDocumentBody {
  title: string;
  blocks: { id: string; type: string; text?: string }[];
  publishedAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Public Sharing (Stage 7, e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let collabUrl: string;
  let collaborationService: CollaborationService;
  const sockets: Socket[] = [];

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
    await app.listen(0);
    const httpServer = app.getHttpServer() as import('http').Server;
    const port = (httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
    collabUrl = `${baseUrl}/collab`;
    collaborationService = app.get(CollaborationService);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(token: string): Socket {
    const socket = io(collabUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  async function register(
    email: string,
    firstName: string,
  ): Promise<AuthResponseBody> {
    const res = await request(baseUrl)
      .post('/api/auth/register')
      .send({ email, password: 'password123', firstName, lastName: 'Test' })
      .expect(201);
    return res.body as AuthResponseBody;
  }

  async function createWorkspace(token: string, name: string): Promise<string> {
    const res = await request(baseUrl)
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
  ): Promise<string> {
    const res = await request(baseUrl)
      .post(`/api/workspaces/${workspaceId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title })
      .expect(201);
    return (res.body as DocumentBody).id;
  }

  async function invite(
    ownerToken: string,
    workspaceId: string,
    email: string,
    role: string,
  ): Promise<string> {
    const res = await request(baseUrl)
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, role })
      .expect(201);
    return (res.body as InvitationBody).inviteToken;
  }

  async function acceptInvite(
    token: string,
    inviteToken: string,
  ): Promise<void> {
    await request(baseUrl)
      .post(`/api/invitations/${inviteToken}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  function join(
    socket: Socket,
    workspaceId: string,
    documentId: string,
  ): Promise<JoinedPayload> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for "joined"')),
        3000,
      );
      socket.once('joined', (payload: JoinedPayload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.emit('join', { workspaceId, documentId });
    });
  }

  function writeText(socket: Socket, ydoc: Y.Doc, text: string): void {
    ydoc.getArray('blocks').delete(0, ydoc.getArray('blocks').length);
    const block = new Y.Map<unknown>();
    block.set('id', 'b1');
    block.set('type', 'paragraph');
    const ytext = new Y.Text();
    ytext.insert(0, text);
    block.set('text', ytext);
    ydoc.getArray('blocks').insert(0, [block]);
    socket.emit('sync-update', Buffer.from(Y.encodeStateAsUpdate(ydoc)));
  }

  describe('Flow A - publish, view publicly, unpublish', () => {
    it('an editor publishes, a public visitor can view it with no auth, then unpublish removes access', async () => {
      // Title includes RUN_ID (same reasoning as emailFor for users) so the
      // derived slug is unique across repeated runs against the same
      // persistent dev/e2e Postgres instance - otherwise a second run
      // would legitimately hit the collision-retry path this file already
      // tests separately in Flow E, and this exact-slug assertion would
      // flake depending on run history.
      const title = `My Published Doc ${RUN_ID}`;
      const expectedSlug = `my-published-doc-${RUN_ID}`;
      const owner = await register(emailFor('pub-owner-a'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS A');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        title,
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      await join(socket, workspaceId, documentId);
      writeText(socket, ydoc, 'Hello, public world!');
      await sleep(500); // let the durability buffer flush (200ms in tests)

      const publishRes = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const published = publishRes.body as DocumentBody;
      expect(published.isPublished).toBe(true);
      expect(published.publicSlug).toBe(expectedSlug);

      // No Authorization header at all - this is the whole point.
      const publicRes = await request(baseUrl)
        .get(`/api/public/documents/${published.publicSlug}`)
        .expect(200);
      const publicBody = publicRes.body as PublicDocumentBody;
      expect(publicBody.title).toBe(title);
      expect(publicBody.blocks[0].text).toBe('Hello, public world!');

      await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/unpublish`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(201);

      await request(baseUrl)
        .get(`/api/public/documents/${published.publicSlug}`)
        .expect(404);
    });
  });

  describe('Flow B - never-published and unpublished slugs 404', () => {
    it('a random slug returns 404', async () => {
      await request(baseUrl)
        .get('/api/public/documents/this-slug-does-not-exist')
        .expect(404);
    });
  });

  describe('Flow C - VIEWER cannot publish or unpublish', () => {
    it('rejects VIEWER publish/unpublish with 403', async () => {
      const owner = await register(emailFor('pub-owner-c'), 'Owner');
      const viewerEmail = emailFor('pub-viewer-c');
      const viewer = await register(viewerEmail, 'Viewer');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS C');
      const inviteToken = await invite(
        owner.accessToken,
        workspaceId,
        viewerEmail,
        'VIEWER',
      );
      await acceptInvite(viewer.accessToken, inviteToken);
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Viewer Blocked Doc',
      );

      await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({})
        .expect(403);

      // Owner publishes so we can also confirm VIEWER can't unpublish it.
      await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);

      await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/unpublish`,
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(403);
    });
  });

  describe('Flow D - outsider and cross-workspace IDOR protection', () => {
    it('an outsider gets 404, never 403, for publish/unpublish', async () => {
      const owner = await register(emailFor('pub-owner-d'), 'Owner');
      const outsider = await register(emailFor('pub-outsider-d'), 'Outsider');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS D');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Private Doc D',
      );

      await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({})
        .expect(404);

      await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/unpublish`,
        )
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
    });

    it('a workspace B document cannot be published through workspace A route', async () => {
      const ownerA = await register(emailFor('pub-owner-e-a'), 'OwnerA');
      const ownerB = await register(emailFor('pub-owner-e-b'), 'OwnerB');
      const workspaceA = await createWorkspace(
        ownerA.accessToken,
        'Pub WS E-A',
      );
      const workspaceB = await createWorkspace(
        ownerB.accessToken,
        'Pub WS E-B',
      );
      const documentInB = await createDocument(
        ownerB.accessToken,
        workspaceB,
        'Doc in B',
      );

      await request(baseUrl)
        .post(`/api/workspaces/${workspaceA}/documents/${documentInB}/publish`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({})
        .expect(404);
    });
  });

  describe('Flow E - slug collision is handled safely', () => {
    it('publishing two documents with the same title yields two distinct, independently resolvable slugs', async () => {
      const owner = await register(emailFor('pub-owner-f'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS F');
      const docA = await createDocument(
        owner.accessToken,
        workspaceId,
        'Duplicate Title',
      );
      const docB = await createDocument(
        owner.accessToken,
        workspaceId,
        'Duplicate Title',
      );

      const resA = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${docA}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const resB = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${docB}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);

      const slugA = (resA.body as DocumentBody).publicSlug!;
      const slugB = (resB.body as DocumentBody).publicSlug!;
      expect(slugA).not.toBe(slugB);

      await request(baseUrl).get(`/api/public/documents/${slugA}`).expect(200);
      await request(baseUrl).get(`/api/public/documents/${slugB}`).expect(200);
    });
  });

  describe('Flow F - archiving auto-unpublishes', () => {
    it('archiving a published document makes its public URL 404, and publishing an archived document is rejected', async () => {
      const owner = await register(emailFor('pub-owner-g'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS G');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Archive Me',
      );

      const publishRes = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const slug = (publishRes.body as DocumentBody).publicSlug!;

      await request(baseUrl)
        .delete(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(204);

      await request(baseUrl).get(`/api/public/documents/${slug}`).expect(404);

      await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('Flow G - public response never exposes private data', () => {
    it('the public JSON has exactly title/blocks/publishedAt - no ids, no author info', async () => {
      const owner = await register(emailFor('pub-owner-h'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS H');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'No Leaks',
      );
      const publishRes = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const slug = (publishRes.body as DocumentBody).publicSlug!;

      const publicRes = await request(baseUrl)
        .get(`/api/public/documents/${slug}`)
        .expect(200);

      expect(Object.keys(publicRes.body as object).sort()).toEqual(
        ['blocks', 'publishedAt', 'title'].sort(),
      );
    });
  });

  describe('Flow H - a stored XSS-shaped payload is passed through as inert text data, not executable markup', () => {
    it('the public API returns the raw text as a JSON string field, not as unescaped HTML', async () => {
      const owner = await register(emailFor('pub-owner-i'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS I');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'XSS Test',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      await join(socket, workspaceId, documentId);
      const payload = '<script>window.__xss = true;</script>';
      writeText(socket, ydoc, payload);
      await sleep(500);

      const publishRes = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const slug = (publishRes.body as DocumentBody).publicSlug!;

      const publicRes = await request(baseUrl)
        .get(`/api/public/documents/${slug}`)
        .expect(200);
      const body = publicRes.body as PublicDocumentBody;

      // The API is a JSON contract, not HTML - the payload must come back
      // as an ordinary string value (Content-Type: application/json),
      // never spliced into a response body as raw markup. Actual
      // browser-side escaping is verified live against the rendered
      // Next.js page (see the Stage 7 report's Live Verification section).
      expect(publicRes.headers['content-type']).toMatch(/application\/json/);
      expect(body.blocks[0].text).toBe(payload);
    });
  });

  describe('Flow I - public rendering uses durable state, not a live in-memory session', () => {
    it('content published while editing remains visible after the in-memory session is evicted', async () => {
      const owner = await register(emailFor('pub-owner-j'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS J');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Durable Content',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      await join(socket, workspaceId, documentId);
      writeText(socket, ydoc, 'content that must survive eviction');
      await sleep(500);

      const publishRes = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const slug = (publishRes.body as DocumentBody).publicSlug!;

      // Simulate "no live session at all" - exactly what a fresh backend
      // process (or a document nobody has opened since restart) looks like.
      socket.disconnect();
      await sleep(50);
      collaborationService.evictSession(documentId);
      expect(collaborationService.getSession(documentId)).toBeUndefined();

      const publicRes = await request(baseUrl)
        .get(`/api/public/documents/${slug}`)
        .expect(200);
      expect((publicRes.body as PublicDocumentBody).blocks[0].text).toBe(
        'content that must survive eviction',
      );
    });
  });

  describe('Flow J - revalidation-relevant update behavior (Model A: latest state)', () => {
    it('editing content after publishing changes what the public endpoint returns, without a new publish call', async () => {
      const owner = await register(emailFor('pub-owner-k'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Pub WS K');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Live Update Doc',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      await join(socket, workspaceId, documentId);
      writeText(socket, ydoc, 'version one');
      await sleep(500);

      const publishRes = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const slug = (publishRes.body as DocumentBody).publicSlug!;

      const firstView = await request(baseUrl)
        .get(`/api/public/documents/${slug}`)
        .expect(200);
      expect((firstView.body as PublicDocumentBody).blocks[0].text).toBe(
        'version one',
      );

      writeText(socket, ydoc, 'version two');
      await sleep(500);

      const secondView = await request(baseUrl)
        .get(`/api/public/documents/${slug}`)
        .expect(200);
      expect((secondView.body as PublicDocumentBody).blocks[0].text).toBe(
        'version two',
      );
    });
  });
});
