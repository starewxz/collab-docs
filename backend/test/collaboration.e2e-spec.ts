import type { AddressInfo } from 'net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';

const RUN_ID = Date.now();
const emailFor = (name: string) => `${name}-${RUN_ID}@example.com`;

// yjs's shipped .d.ts omits YText's toString() override (it exists and
// works correctly at runtime); this wraps the single justified disable.
function textContent(doc: Y.Doc): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return doc.getText('content').toString();
}

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
  role: string | null;
  self: { id: string; name: string };
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

function waitForDisconnect(socket: Socket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for disconnect')),
      timeoutMs,
    );
    socket.once('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('Collaboration (e2e)', () => {
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

  /** No `auth.token` at all - the anonymous connection a public edit-by-link
   * visitor makes (see `handleConnection`'s "missing token" branch). */
  function connectAnonymous(): Socket {
    const socket = io(collabUrl, {
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

  async function join(
    socket: Socket,
    workspaceId: string,
    documentId: string,
  ): Promise<JoinedPayload> {
    const joined = waitForEvent<JoinedPayload>(socket, 'joined');
    socket.emit('join', { workspaceId, documentId });
    return joined;
  }

  async function joinPublic(
    socket: Socket,
    slug: string,
  ): Promise<JoinedPayload> {
    const joined = waitForEvent<JoinedPayload>(socket, 'joined');
    socket.emit('join-public', { slug });
    return joined;
  }

  async function restrictDocument(
    ownerToken: string,
    workspaceId: string,
    documentId: string,
  ): Promise<void> {
    await request(baseUrl)
      .patch(`/api/workspaces/${workspaceId}/documents/${documentId}/access`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ restricted: true })
      .expect(200);
  }

  async function shareDocument(
    ownerToken: string,
    workspaceId: string,
    documentId: string,
    userId: string,
    accessLevel: 'VIEWER' | 'EDITOR',
  ): Promise<void> {
    await request(baseUrl)
      .post(
        `/api/workspaces/${workspaceId}/documents/${documentId}/collaborators`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId, accessLevel })
      .expect(201);
  }

  interface PublishBody {
    publicSlug: string;
  }

  async function publishDocument(
    token: string,
    workspaceId: string,
    documentId: string,
    body: { mode?: 'view' | 'edit'; expiresAt?: string } = {},
  ): Promise<string> {
    const res = await request(baseUrl)
      .post(`/api/workspaces/${workspaceId}/documents/${documentId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return (res.body as PublishBody).publicSlug;
  }

  describe('Document-level ACL over the gateway (TT gap 1)', () => {
    it('a restricted document rejects join for a non-shared workspace EDITOR, then admits them once shared', async () => {
      const owner = await register(emailFor('gw-acl-owner'), 'Owner');
      const editorEmail = emailFor('gw-acl-editor');
      const editor = await register(editorEmail, 'Editor');
      const workspaceId = await createWorkspace(owner.accessToken, 'GW ACL WS');
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
        'GW ACL Doc',
      );
      await restrictDocument(owner.accessToken, workspaceId, documentId);

      const editorSocket = connect(editor.accessToken);
      const disconnected = waitForDisconnect(editorSocket);
      const joinError = waitForEvent(editorSocket, 'join-error');
      editorSocket.emit('join', { workspaceId, documentId });
      await Promise.all([disconnected, joinError]);

      await shareDocument(
        owner.accessToken,
        workspaceId,
        documentId,
        editor.user.id,
        'VIEWER',
      );

      const reconnected = connect(editor.accessToken);
      const joined = await join(reconnected, workspaceId, documentId);
      expect(joined.canEdit).toBe(false);

      // A read-only join must not let the client publish edits either.
      const rejected = waitForEvent(reconnected, 'update-rejected');
      const scratch = new Y.Doc();
      scratch.getText('content').insert(0, 'nope');
      reconnected.emit(
        'sync-update',
        Buffer.from(Y.encodeStateAsUpdate(scratch)),
      );
      await rejected;
      scratch.destroy();
    });
  });

  describe('Async search indexing (TT gap 6)', () => {
    it('a collaborative edit becomes searchable only after the async index job runs, not synchronously', async () => {
      const owner = await register(emailFor('async-search-owner'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Async Search WS',
      );
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Async Search Doc',
      );

      const socket = connect(owner.accessToken);
      await join(socket, workspaceId, documentId);

      // The search indexer decodes the `blocks` Y.Array model (see
      // yjs-document.util.ts), not a bare `getText('content')` - unlike
      // this file's other tests, which only exercise raw CRDT byte
      // relaying and don't care about block shape.
      const writerDoc = new Y.Doc();
      const block = new Y.Map<unknown>();
      block.set('id', 'b1');
      block.set('type', 'paragraph');
      const ytext = new Y.Text();
      ytext.insert(0, 'zzasyncindexedneedle');
      block.set('text', ytext);
      writerDoc.getArray('blocks').insert(0, [block]);
      socket.emit('sync-update', Buffer.from(Y.encodeStateAsUpdate(writerDoc)));

      // Right after the edit, the flush (and therefore the enqueue) hasn't
      // happened yet - COLLAB_PERSIST_INTERVAL_MS is 200ms in the test env
      // (see test/.env.test), so a search immediately afterwards must not
      // find it yet. This is the behavior that distinguishes "async via
      // queue" from "synchronous in the request".
      const immediate = await request(baseUrl)
        .get(`/api/workspaces/${workspaceId}/documents/search`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .query({ q: 'zzasyncindexedneedle' })
        .expect(200);
      expect((immediate.body as { id: string }[]).length).toBe(0);

      // After the flush interval elapses (enqueuing the job) and the
      // in-process worker has had time to run it, the document is
      // searchable - proving the content reached the index via the queue,
      // not the original request.
      let found = false;
      for (let attempt = 0; attempt < 20 && !found; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const res = await request(baseUrl)
          .get(`/api/workspaces/${workspaceId}/documents/search`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .query({ q: 'zzasyncindexedneedle' })
          .expect(200);
        found = (res.body as { id: string }[]).some((d) => d.id === documentId);
      }
      expect(found).toBe(true);
    }, 15000);
  });

  describe('Public edit-by-link (TT gap 2)', () => {
    // One owner/workspace shared across this block's tests (each creates
    // its own document) - keeps registration calls down so this suite
    // doesn't trip the register-endpoint rate limiter alongside every
    // other describe block in this file that also registers users.
    let sharedOwner: AuthResponseBody;
    let sharedWorkspaceId: string;

    beforeAll(async () => {
      sharedOwner = await register(emailFor('pub-link-owner'), 'Owner');
      sharedWorkspaceId = await createWorkspace(
        sharedOwner.accessToken,
        'Public Link WS',
      );
    });

    it('an anonymous visitor can join and edit a document published in edit mode, scoped to that document only', async () => {
      const owner = sharedOwner;
      const workspaceId = sharedWorkspaceId;
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Public Edit Doc',
      );
      const slug = await publishDocument(
        owner.accessToken,
        workspaceId,
        documentId,
        {
          mode: 'edit',
        },
      );

      const ownerSocket = connect(owner.accessToken);
      const ownerDoc = new Y.Doc();
      ownerSocket.on('sync-update', (update: ArrayBuffer) =>
        Y.applyUpdate(ownerDoc, new Uint8Array(update)),
      );
      await join(ownerSocket, workspaceId, documentId);

      const publicSocket = connectAnonymous();
      const publicJoined = await joinPublic(publicSocket, slug);
      expect(publicJoined.canEdit).toBe(true);
      expect(publicJoined.role).toBeNull();

      const publicDoc = new Y.Doc();
      publicDoc.getText('content').insert(0, 'edited by the public');
      const relayed = waitForEvent(ownerSocket, 'sync-update');
      publicSocket.emit(
        'sync-update',
        Buffer.from(Y.encodeStateAsUpdate(publicDoc)),
      );
      await relayed;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(textContent(ownerDoc)).toBe('edited by the public');
      publicDoc.destroy();
    });

    it('a view-only public link does not accept join-public as an editor', async () => {
      const documentId = await createDocument(
        sharedOwner.accessToken,
        sharedWorkspaceId,
        'Public View Doc',
      );
      const slug = await publishDocument(
        sharedOwner.accessToken,
        sharedWorkspaceId,
        documentId,
      );

      const publicSocket = connectAnonymous();
      const disconnected = waitForDisconnect(publicSocket);
      const joinError = waitForEvent(publicSocket, 'join-error');
      publicSocket.emit('join-public', { slug });
      await Promise.all([disconnected, joinError]);
    });

    it('an expired edit link is rejected the same as an unpublished one', async () => {
      const documentId = await createDocument(
        sharedOwner.accessToken,
        sharedWorkspaceId,
        'Public Expired Doc',
      );
      const past = new Date(Date.now() - 60_000).toISOString();
      const slug = await publishDocument(
        sharedOwner.accessToken,
        sharedWorkspaceId,
        documentId,
        {
          mode: 'edit',
          expiresAt: past,
        },
      );

      await request(baseUrl).get(`/api/public/documents/${slug}`).expect(404);

      const publicSocket = connectAnonymous();
      const disconnected = waitForDisconnect(publicSocket);
      const joinError = waitForEvent(publicSocket, 'join-error');
      publicSocket.emit('join-public', { slug });
      await Promise.all([disconnected, joinError]);
    });
  });

  describe('Concurrent edit convergence (the most important test)', () => {
    it('two clients editing concurrently converge to the same state with both edits surviving', async () => {
      const owner = await register(emailFor('collab-owner'), 'Owner');
      const editorEmail = emailFor('collab-editor');
      const editor = await register(editorEmail, 'Editor');
      const workspaceId = await createWorkspace(owner.accessToken, 'Collab WS');
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
        'Shared Doc',
      );

      const socketA = connect(owner.accessToken);
      const socketB = connect(editor.accessToken);

      const docA = new Y.Doc();
      const docB = new Y.Doc();
      socketA.on('sync-update', (update: ArrayBuffer) =>
        Y.applyUpdate(docA, new Uint8Array(update)),
      );
      socketB.on('sync-update', (update: ArrayBuffer) =>
        Y.applyUpdate(docB, new Uint8Array(update)),
      );

      await Promise.all([
        join(socketA, workspaceId, documentId),
        join(socketB, workspaceId, documentId),
      ]);

      // A and B each make one independent, concurrent edit from their own doc.
      docA.getText('content').insert(0, 'Edit from A. ');
      socketA.emit('sync-update', Buffer.from(Y.encodeStateAsUpdate(docA)));

      docB.getText('content').insert(0, 'Edit from B. ');
      socketB.emit('sync-update', Buffer.from(Y.encodeStateAsUpdate(docB)));

      // Let both updates propagate and merge on both sides.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const finalA = textContent(docA);
      const finalB = textContent(docB);

      expect(finalA).toBe(finalB); // converged
      expect(finalA).toContain('Edit from A.'); // no lost update
      expect(finalA).toContain('Edit from B.'); // no lost update
    });
  });

  describe('Permission enforcement', () => {
    it('VIEWER can join and receive updates but cannot submit edits', async () => {
      const owner = await register(emailFor('perm-owner-1'), 'Owner');
      const viewerEmail = emailFor('perm-viewer-1');
      const viewer = await register(viewerEmail, 'Viewer');
      const workspaceId = await createWorkspace(owner.accessToken, 'Perm WS 1');
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
        'Viewer Doc',
      );

      const socket = connect(viewer.accessToken);
      const joined = await join(socket, workspaceId, documentId);
      expect(joined.canEdit).toBe(false);
      expect(joined.role).toBe('VIEWER');

      const ydoc = new Y.Doc();
      ydoc.getText('content').insert(0, 'viewer edit attempt');
      const rejection = waitForEvent<{ reason: string }>(
        socket,
        'update-rejected',
      );
      socket.emit('sync-update', Buffer.from(Y.encodeStateAsUpdate(ydoc)));
      const result = await rejection;
      expect(result.reason).toBe('read-only');
    });

    it('EDITOR can join and submit edits', async () => {
      const owner = await register(emailFor('perm-owner-2'), 'Owner');
      const editorEmail = emailFor('perm-editor-2');
      const editor = await register(editorEmail, 'Editor');
      const workspaceId = await createWorkspace(owner.accessToken, 'Perm WS 2');
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
        'Editor Doc',
      );

      const editorSocket = connect(editor.accessToken);
      const observerSocket = connect(owner.accessToken);
      const joined = await join(editorSocket, workspaceId, documentId);
      expect(joined.canEdit).toBe(true);
      await join(observerSocket, workspaceId, documentId);

      const ydoc = new Y.Doc();
      ydoc.getText('content').insert(0, 'editor wrote this');
      const observerDoc = new Y.Doc();
      observerSocket.on('sync-update', (update: ArrayBuffer) =>
        Y.applyUpdate(observerDoc, new Uint8Array(update)),
      );
      const relayed = waitForEvent<ArrayBuffer>(observerSocket, 'sync-update');
      editorSocket.emit(
        'sync-update',
        Buffer.from(Y.encodeStateAsUpdate(ydoc)),
      );
      await relayed;

      expect(textContent(observerDoc)).toBe('editor wrote this');
    });

    it('an outsider cannot join the collaboration session', async () => {
      const owner = await register(emailFor('perm-owner-3'), 'Owner');
      const outsider = await register(emailFor('perm-outsider-3'), 'Outsider');
      const workspaceId = await createWorkspace(owner.accessToken, 'Perm WS 3');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Private Doc',
      );

      const socket = connect(outsider.accessToken);
      const error = waitForEvent<{ message: string }>(socket, 'join-error');
      socket.emit('join', { workspaceId, documentId });
      await error;
    });

    it('a user from workspace A cannot join a workspace B document', async () => {
      const ownerA = await register(emailFor('perm-owner-4a'), 'OwnerA');
      const ownerB = await register(emailFor('perm-owner-4b'), 'OwnerB');
      // ownerA needs to be a legitimate member of *some* workspace, just not
      // workspace B - the id itself isn't used below.
      await createWorkspace(ownerA.accessToken, 'Perm WS 4A');
      const workspaceB = await createWorkspace(
        ownerB.accessToken,
        'Perm WS 4B',
      );
      const documentInB = await createDocument(
        ownerB.accessToken,
        workspaceB,
        'B Doc',
      );

      // ownerA is a member of workspace A, but not workspace B - attempting
      // to join workspace B's document must be rejected the same as an
      // outsider, even though ownerA is a legitimate member elsewhere.
      const socket = connect(ownerA.accessToken);
      const error = waitForEvent<{ message: string }>(socket, 'join-error');
      socket.emit('join', { workspaceId: workspaceB, documentId: documentInB });
      await error;

      // Sanity: the same document ID is real and joinable by its own owner.
      const legitSocket = connect(ownerB.accessToken);
      const joined = await join(legitSocket, workspaceB, documentInB);
      expect(joined.documentId).toBe(documentInB);
    });

    it('an archived document is read-only for everyone, including editors', async () => {
      const owner = await register(emailFor('perm-owner-5'), 'Owner');
      const workspaceId = await createWorkspace(owner.accessToken, 'Perm WS 5');
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'To Archive',
      );
      await request(baseUrl)
        .delete(`/api/workspaces/${workspaceId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(204);

      const socket = connect(owner.accessToken);
      const joined = await join(socket, workspaceId, documentId);
      expect(joined.canEdit).toBe(false);
    });
  });

  describe('Presence', () => {
    it('a joining collaborator becomes visible to an already-connected client', async () => {
      const owner = await register(emailFor('presence-owner-1'), 'Owner');
      const editorEmail = emailFor('presence-editor-1');
      const editor = await register(editorEmail, 'Editor');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Presence WS 1',
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
        'Presence Doc',
      );

      const socketA = connect(owner.accessToken);
      await join(socketA, workspaceId, documentId);

      const presenceSeen = waitForEvent<ArrayBuffer>(
        socketA,
        'awareness-update',
      );
      const socketB = connect(editor.accessToken);
      const joinedB = await join(socketB, workspaceId, documentId);

      // Build a real awareness update: publish B's own local state via a
      // scratch Y.Doc + Awareness pair, exactly like a browser client would.
      const bDoc = new Y.Doc();
      const bAwareness = new Awareness(bDoc);
      bAwareness.setLocalState({
        user: { id: joinedB.self.id, name: joinedB.self.name },
      });
      socketB.emit(
        'awareness-update',
        Buffer.from(encodeAwarenessUpdate(bAwareness, [bAwareness.clientID])),
      );

      const update = await presenceSeen;
      expect(update).toBeDefined();
      bAwareness.destroy();
    });

    it('disconnecting removes presence for remaining collaborators', async () => {
      const owner = await register(emailFor('presence-owner-2'), 'Owner');
      const editorEmail = emailFor('presence-editor-2');
      const editor = await register(editorEmail, 'Editor');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Presence WS 2',
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
        'Presence Doc 2',
      );

      const socketA = connect(owner.accessToken);
      await join(socketA, workspaceId, documentId);
      const socketB = connect(editor.accessToken);
      const joinedB = await join(socketB, workspaceId, documentId);

      const bDoc = new Y.Doc();
      const bAwareness = new Awareness(bDoc);
      bAwareness.setLocalState({
        user: { id: joinedB.self.id, name: joinedB.self.name },
      });

      const firstPresence = waitForEvent<ArrayBuffer>(
        socketA,
        'awareness-update',
      );
      socketB.emit(
        'awareness-update',
        Buffer.from(encodeAwarenessUpdate(bAwareness, [bAwareness.clientID])),
      );
      await firstPresence;

      const removalPresence = waitForEvent<ArrayBuffer>(
        socketA,
        'awareness-update',
      );
      socketB.disconnect();
      await removalPresence; // the server broadcasts a removal on disconnect
      bAwareness.destroy();
    });

    it('presence is scoped to the correct document - a client on a different document sees nothing', async () => {
      const owner = await register(emailFor('presence-owner-3'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Presence WS 3',
      );
      const documentA = await createDocument(
        owner.accessToken,
        workspaceId,
        'Doc A',
      );
      const documentB = await createDocument(
        owner.accessToken,
        workspaceId,
        'Doc B',
      );

      const socketOnA = connect(owner.accessToken);
      await join(socketOnA, workspaceId, documentA);

      const socketOnB = connect(owner.accessToken);
      const joinedOnB = await join(socketOnB, workspaceId, documentB);

      let receivedOnA = false;
      socketOnA.on('awareness-update', () => {
        receivedOnA = true;
      });

      const scratchDoc = new Y.Doc();
      const scratchAwareness = new Awareness(scratchDoc);
      scratchAwareness.setLocalState({
        user: { id: joinedOnB.self.id, name: 'On Doc B' },
      });
      socketOnB.emit(
        'awareness-update',
        Buffer.from(
          encodeAwarenessUpdate(scratchAwareness, [scratchAwareness.clientID]),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(receivedOnA).toBe(false);
      scratchAwareness.destroy();
    });
  });

  describe('Reconnect / resync', () => {
    it('after a disconnect, rejoining resynchronizes the current CRDT state', async () => {
      const owner = await register(emailFor('reconnect-owner-1'), 'Owner');
      const workspaceId = await createWorkspace(
        owner.accessToken,
        'Reconnect WS',
      );
      const documentId = await createDocument(
        owner.accessToken,
        workspaceId,
        'Reconnect Doc',
      );

      const writerSocket = connect(owner.accessToken);
      await join(writerSocket, workspaceId, documentId);
      const writerDoc = new Y.Doc();
      writerDoc.getText('content').insert(0, 'persisted before reconnect');
      writerSocket.emit(
        'sync-update',
        Buffer.from(Y.encodeStateAsUpdate(writerDoc)),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      const clientSocket = connect(owner.accessToken);
      const clientDoc = new Y.Doc();
      clientSocket.on('sync-update', (update: ArrayBuffer) =>
        Y.applyUpdate(clientDoc, new Uint8Array(update)),
      );
      await join(clientSocket, workspaceId, documentId);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(textContent(clientDoc)).toBe('persisted before reconnect');

      // Simulate a network drop: disconnect and reconnect with a fresh
      // socket + a fresh (empty) local Y.Doc, as a real client reload would.
      const disconnected = waitForDisconnect(clientSocket);
      clientSocket.disconnect();
      await disconnected;

      const resyncedDoc = new Y.Doc();
      const reconnectSocket = connect(owner.accessToken);
      reconnectSocket.on('sync-update', (update: ArrayBuffer) =>
        Y.applyUpdate(resyncedDoc, new Uint8Array(update)),
      );
      await join(reconnectSocket, workspaceId, documentId);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(textContent(resyncedDoc)).toBe('persisted before reconnect');
    });
  });
});
