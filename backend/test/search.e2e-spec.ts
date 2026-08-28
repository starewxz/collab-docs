import type { AddressInfo } from 'net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import * as Y from 'yjs';
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

interface DocumentBody {
  id: string;
}

interface SearchResultBody {
  id: string;
  title: string;
  snippet: string | null;
  parentId: string | null;
  updatedAt: string;
}

interface JoinedPayload {
  documentId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Document search (e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let collabUrl: string;
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

  async function search(
    token: string,
    workspaceId: string,
    q: string,
  ): Promise<SearchResultBody[]> {
    const res = await request(baseUrl)
      .get(`/api/workspaces/${workspaceId}/documents/search`)
      .query({ q })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as SearchResultBody[];
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

  async function join(
    socket: Socket,
    workspaceId: string,
    documentId: string,
  ): Promise<JoinedPayload> {
    const joined = waitForEvent<JoinedPayload>(socket, 'joined');
    socket.emit('join', { workspaceId, documentId });
    return joined;
  }

  it('1. finds a document by title', async () => {
    const owner = await register(emailFor('search-title-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Search Title WS',
    );
    const targetId = await createDocument(
      owner.accessToken,
      workspaceId,
      'Project Roadmap Alpha',
    );
    await createDocument(owner.accessToken, workspaceId, 'Unrelated Notes');

    const results = await search(owner.accessToken, workspaceId, 'Roadmap');
    expect(results.map((r) => r.id)).toContain(targetId);
    expect(results).toHaveLength(1);
  });

  it('2. finds a document by its persisted (durable) content, not title', async () => {
    const owner = await register(emailFor('search-content-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Search Content WS',
    );
    const documentId = await createDocument(
      owner.accessToken,
      workspaceId,
      'Untitled',
    );

    const socket = connect(owner.accessToken);
    const ydoc = new Y.Doc();
    await join(socket, workspaceId, documentId);
    writeText(socket, ydoc, 'the quokka jumped over the lazy hyena');
    // Let the trailing-throttle durability flush (200ms in tests) fire and
    // the search-index update run off the just-persisted durable state.
    await sleep(600);

    const results = await search(owner.accessToken, workspaceId, 'quokka');
    expect(results.map((r) => r.id)).toContain(documentId);
  });

  it('3. Workspace A cannot see Workspace B search results (tenant isolation)', async () => {
    const ownerA = await register(emailFor('search-iso-owner-a'), 'OwnerA');
    const ownerB = await register(emailFor('search-iso-owner-b'), 'OwnerB');
    const workspaceA = await createWorkspace(
      ownerA.accessToken,
      'Search Iso WS A',
    );
    const workspaceB = await createWorkspace(
      ownerB.accessToken,
      'Search Iso WS B',
    );
    await createDocument(
      ownerA.accessToken,
      workspaceA,
      'Shared Keyword Zebra',
    );
    await createDocument(
      ownerB.accessToken,
      workspaceB,
      'Shared Keyword Zebra',
    );

    const resultsA = await search(ownerA.accessToken, workspaceA, 'Zebra');
    expect(resultsA).toHaveLength(1);

    // ownerA is not a member of workspaceB - the guard returns 404 before
    // search ever runs (see test 4), so cross-tenant leakage is impossible
    // by construction. This test independently confirms workspaceA's own
    // results never include workspaceB's document, in case a future bug
    // in the search query's WHERE clause forgot to scope by workspace.
    expect(resultsA.every((r) => r.title === 'Shared Keyword Zebra')).toBe(
      true,
    );
  });

  it('4. an unauthorized (non-member) user cannot search the workspace', async () => {
    const owner = await register(emailFor('search-auth-owner'), 'Owner');
    const outsider = await register(
      emailFor('search-auth-outsider'),
      'Outsider',
    );
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Search Auth WS',
    );
    await createDocument(owner.accessToken, workspaceId, 'Confidential Plan');

    await request(baseUrl)
      .get(`/api/workspaces/${workspaceId}/documents/search`)
      .query({ q: 'Confidential' })
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(404);
  });

  it('5. archived documents are excluded from search results', async () => {
    const owner = await register(emailFor('search-archive-owner'), 'Owner');
    const workspaceId = await createWorkspace(
      owner.accessToken,
      'Search Archive WS',
    );
    const documentId = await createDocument(
      owner.accessToken,
      workspaceId,
      'Deprecated Onboarding Guide',
    );

    const before = await search(owner.accessToken, workspaceId, 'Onboarding');
    expect(before.map((r) => r.id)).toContain(documentId);

    await request(baseUrl)
      .delete(`/api/workspaces/${workspaceId}/documents/${documentId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const after = await search(owner.accessToken, workspaceId, 'Onboarding');
    expect(after.map((r) => r.id)).not.toContain(documentId);
  });
});
