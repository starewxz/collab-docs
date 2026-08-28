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

interface VersionBody {
  id: string;
  label: string | null;
  kind: string;
}

interface RestoreResponseBody {
  restoredFromVersionId: string;
  historyVersionId: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Document versions & durable persistence (e2e)', () => {
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
    const workspaceId = (res.body as WorkspaceBody).id;
    // Manual version snapshots are a Stage 8 PRO-gated feature - this
    // whole file is testing version-history mechanics, not plan gating,
    // so every workspace here upgrades immediately via the mock billing
    // flow (see billing.e2e-spec.ts for the plan-limit-focused tests).
    await request(baseUrl)
      .post(`/api/workspaces/${workspaceId}/billing/mock-pay`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return workspaceId;
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

  async function join(
    socket: Socket,
    workspaceId: string,
    documentId: string,
  ): Promise<JoinedPayload> {
    const joined = waitForEvent<JoinedPayload>(socket, 'joined');
    socket.emit('join', { workspaceId, documentId });
    return joined;
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

  function readText(ydoc: Y.Doc): string | undefined {
    const blocks = ydoc.getArray<Y.Map<unknown>>('blocks');
    if (blocks.length === 0) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- yjs's .d.ts omits YText's toString() override; it exists and works at runtime.
    return (blocks.get(0).get('text') as Y.Text).toString();
  }

  describe('Persistence round-trip', () => {
    it('content survives destroying and recreating the in-memory session', async () => {
      const owner = await register(emailFor('persist-owner-1'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Persist WS 1',
      );
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Persist Doc 1',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      socket.on('sync-update', (u: ArrayBuffer) =>
        Y.applyUpdate(ydoc, new Uint8Array(u)),
      );
      await join(socket, workspaceId, documentId);

      writeText(socket, ydoc, 'content before restart');
      // Give the trailing-throttle flush (200ms in tests) time to fire.
      await sleep(500);

      // Simulate "all clients disconnect + session eviction/restart": drop
      // the socket and force-evict the in-memory session directly, exactly
      // what a real server restart would do to CollaborationService's map.
      socket.disconnect();
      await sleep(50);
      collaborationService.evictSession(documentId);
      expect(collaborationService.getSession(documentId)).toBeUndefined();

      const freshSocket = connect(owner.accessToken);
      const freshDoc = new Y.Doc();
      freshSocket.on('sync-update', (u: ArrayBuffer) =>
        Y.applyUpdate(freshDoc, new Uint8Array(u)),
      );
      await join(freshSocket, workspaceId, documentId);
      await sleep(200);

      expect(readText(freshDoc)).toBe('content before restart');
    });
  });

  describe('Restart-like hydration produces an identical CRDT state', () => {
    it('a freshly decoded Y.Doc from persisted bytes matches the original content', async () => {
      const owner = await register(emailFor('persist-owner-2'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Persist WS 2',
      );
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Persist Doc 2',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      await join(socket, workspaceId, documentId);
      writeText(socket, ydoc, 'hydration check');
      await sleep(500);

      const res = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);
      const versionId = (res.body as VersionBody).id;

      const inspectRes = await request(baseUrl)
        .get(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${versionId}`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(
        (inspectRes.body as { blocks: { text: string }[] }).blocks[0].text,
      ).toBe('hydration check');
    });
  });

  describe('Versions: create, list, inspect', () => {
    it('both snapshotted states recover correctly via list + inspect', async () => {
      const owner = await register(emailFor('versions-owner-1'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Versions WS 1',
      );
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Versions Doc 1',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      await join(socket, workspaceId, documentId);

      writeText(socket, ydoc, 'Content A');
      await sleep(300);
      const snapA = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ label: 'Version A' })
        .expect(201);

      writeText(socket, ydoc, 'Content B');
      await sleep(300);
      const snapB = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ label: 'Version B' })
        .expect(201);

      const list = await request(baseUrl)
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      const labels = (list.body as VersionBody[]).map((v) => v.label);
      expect(labels).toEqual(
        expect.arrayContaining(['Version A', 'Version B']),
      );

      const inspectA = await request(baseUrl)
        .get(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${(snapA.body as VersionBody).id}`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      const inspectB = await request(baseUrl)
        .get(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${(snapB.body as VersionBody).id}`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(
        (inspectA.body as { blocks: { text: string }[] }).blocks[0].text,
      ).toBe('Content A');
      expect(
        (inspectB.body as { blocks: { text: string }[] }).blocks[0].text,
      ).toBe('Content B');
    });

    it('auto-persisted durability rows never appear in the version list', async () => {
      const owner = await register(emailFor('versions-owner-2'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Versions WS 2',
      );
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Versions Doc 2',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      await join(socket, workspaceId, documentId);
      writeText(socket, ydoc, 'auto content');
      await sleep(500); // let the durability buffer flush at least once

      const list = await request(baseUrl)
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(list.body as VersionBody[]).toHaveLength(0);
    });
  });

  describe('Restore', () => {
    it('restoring an old version makes it current while preserving history', async () => {
      const owner = await register(emailFor('restore-owner-1'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Restore WS 1',
      );
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Restore Doc 1',
      );

      const socket = connect(owner.accessToken);
      const ydoc = new Y.Doc();
      socket.on('sync-update', (u: ArrayBuffer) =>
        Y.applyUpdate(ydoc, new Uint8Array(u)),
      );
      await join(socket, workspaceId, documentId);

      writeText(socket, ydoc, 'Content A');
      await sleep(300);
      const snapA = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ label: 'A' })
        .expect(201);

      writeText(socket, ydoc, 'Content B');
      await sleep(300);

      const restoreRes = await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${(snapA.body as VersionBody).id}/restore`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(201);
      expect(
        (restoreRes.body as RestoreResponseBody).restoredFromVersionId,
      ).toBe((snapA.body as VersionBody).id);

      await sleep(300);
      expect(readText(ydoc)).toBe('Content A');

      const list = await request(baseUrl)
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      // A (manual) + the auto-created restore-point capturing B - history
      // was never destroyed by the restore.
      expect(list.body as VersionBody[]).toHaveLength(2);
      expect(
        (list.body as VersionBody[]).some((v) => v.kind === 'restore-point'),
      ).toBe(true);
    });
  });

  describe('Active collaboration restore', () => {
    it('both connected clients converge to the restored state', async () => {
      const owner = await register(emailFor('active-restore-owner'), 'Owner');
      const editorEmail = emailFor('active-restore-editor');
      const editor = await register(editorEmail, 'Editor');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Active Restore WS',
      );
      const inviteToken = await invite(
        owner.accessToken,
        workspaceId,
        editorEmail,
        'EDITOR',
      );
      await acceptInvite(editor.accessToken, inviteToken);
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Active Restore Doc',
      );

      const socketA = connect(owner.accessToken);
      const docA = new Y.Doc();
      socketA.on('sync-update', (u: ArrayBuffer) =>
        Y.applyUpdate(docA, new Uint8Array(u)),
      );
      await join(socketA, workspaceId, documentId);

      writeText(socketA, docA, 'Original content');
      await sleep(300);
      const snap = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ label: 'Original' })
        .expect(201);

      writeText(socketA, docA, 'Changed content');
      await sleep(300);

      const socketB = connect(editor.accessToken);
      const docB = new Y.Doc();
      socketB.on('sync-update', (u: ArrayBuffer) =>
        Y.applyUpdate(docB, new Uint8Array(u)),
      );
      await join(socketB, workspaceId, documentId);
      await sleep(200);
      expect(readText(docB)).toBe('Changed content');

      await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${(snap.body as VersionBody).id}/restore`,
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(201);

      await sleep(400);
      expect(readText(docA)).toBe('Original content');
      expect(readText(docB)).toBe('Original content');
    });
  });

  describe('Authorization', () => {
    it('VIEWER cannot create or restore versions but can list/inspect', async () => {
      const owner = await register(emailFor('auth-owner-1'), 'Owner');
      const viewerEmail = emailFor('auth-viewer-1');
      const viewer = await register(viewerEmail, 'Viewer');
      const workspaceId = await createWorkspace(owner.accessToken, 'Auth WS 1');
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
        'Auth Doc 1',
      );

      const snap = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ label: 'Owner snapshot' })
        .expect(201);

      await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ label: 'Viewer attempt' })
        .expect(403);

      await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${(snap.body as VersionBody).id}/restore`,
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(403);

      await request(baseUrl)
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(200);
    });

    it('EDITOR can create and restore versions', async () => {
      const owner = await register(emailFor('auth-owner-2'), 'Owner');
      const editorEmail = emailFor('auth-editor-2');
      const editor = await register(editorEmail, 'Editor');
      const workspaceId = await createWorkspace(owner.accessToken, 'Auth WS 2');
      const inviteToken = await invite(
        owner.accessToken,
        workspaceId,
        editorEmail,
        'EDITOR',
      );
      await acceptInvite(editor.accessToken, inviteToken);
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Auth Doc 2',
      );

      const snap = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ label: 'Editor snapshot' })
        .expect(201);

      await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${(snap.body as VersionBody).id}/restore`,
        )
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .expect(201);
    });

    it('an outsider gets 404 for every version endpoint', async () => {
      const owner = await register(emailFor('auth-owner-3'), 'Owner');
      const outsider = await register(emailFor('auth-outsider-3'), 'Outsider');
      const workspaceId = await createWorkspace(owner.accessToken, 'Auth WS 3');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Auth Doc 3',
      );
      const snap = await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ label: 'Owner snapshot' })
        .expect(201);

      await request(baseUrl)
        .get(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);

      await request(baseUrl)
        .post(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({})
        .expect(404);

      await request(baseUrl)
        .post(
          `/api/workspaces/${workspaceId}/documents/${documentId}/versions/${(snap.body as VersionBody).id}/restore`,
        )
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
    });

    it('a user from a different workspace cannot reach this workspace document versions', async () => {
      const ownerA = await register(emailFor('auth-owner-4a'), 'OwnerA');
      const ownerB = await register(emailFor('auth-owner-4b'), 'OwnerB');
      const workspaceA = await createWorkspace(
        ownerA.accessToken,
        'Auth WS 4A',
      );
      const workspaceB = await createWorkspace(
        ownerB.accessToken,
        'Auth WS 4B',
      );
      const documentInB = await createDocument(
        ownerB.accessToken,
        workspaceB,
        'Doc B',
      );

      await request(baseUrl)
        .get(`/api/workspaces/${workspaceA}/documents/${documentInB}/versions`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .expect(404);
    });
  });
});
