import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { PinoLogger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import * as Y from 'yjs';
import { MetricsService } from '../../common/metrics/metrics.service';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { AppConfigService } from '../../config/app-config.service';
import { DocumentsService } from '../documents/documents.service';
import { UsersService } from '../users/users.service';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { WorkspacePermissionsService } from '../workspaces/workspace-permissions.service';
import { CollaborationPersistenceService } from './collaboration-persistence.service';
import {
  CollaborationService,
  type DocumentSession,
} from './collaboration.service';
import { decodeState, replaceBlocksContent } from './yjs-document.util';

/** Grace period before an empty session is evicted from memory - long
 * enough that a brief reconnect (page reload, flaky network) reuses the
 * still-live session instead of forcing a rehydrate from storage.
 * Overridable for tests, same pattern as COLLAB_PERSIST_INTERVAL_MS. */
function evictionGraceMs(): number {
  const configured = Number(process.env.COLLAB_EVICTION_GRACE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 30_000;
}

interface CollabSession {
  workspaceId: string;
  documentId: string;
  canEdit: boolean;
}

/** Everything this gateway stores on a connected socket. */
interface CollabSocketData {
  user?: JwtPayload;
  session?: CollabSession;
}

function roomFor(documentId: string): string {
  return `document:${documentId}`;
}

function data(client: Socket): CollabSocketData {
  return client.data as CollabSocketData;
}

/**
 * Live Yjs collaboration transport, scoped to a single document per
 * connection. Deliberately separate from `DocumentsController` (REST
 * metadata/tree/lifecycle) - this gateway only ever relays CRDT bytes and
 * presence for documents that already exist. See ADR-013.
 */
@WebSocketGateway({
  namespace: '/collab',
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
})
export class CollaborationGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    private readonly documentsService: DocumentsService,
    private readonly permissions: WorkspacePermissionsService,
    private readonly usersService: UsersService,
    private readonly collaboration: CollaborationService,
    private readonly persistence: CollaborationPersistenceService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CollaborationGateway.name);
  }

  /** Verifies the access token from the handshake before any document-scoped
   * message is accepted. A document id is never trusted from the client
   * without the workspace/document checks in `handleJoin`. */
  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      this.rejectConnection(client, 'missing_token');
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.jwt.accessSecret,
      });
      data(client).user = payload;
    } catch {
      this.rejectConnection(client, 'invalid_token');
    }
  }

  handleDisconnect(client: Socket): void {
    const session = data(client).session;
    if (!session) return;
    const { documentId, workspaceId } = session;

    this.collaboration.removeConnection(documentId, client.id);
    this.metrics.collabConnectionsCurrent.dec();
    if (this.collaboration.isSessionEmpty(documentId)) {
      this.metrics.collabSessionsCurrent.dec();
      this.scheduleEviction(documentId);
    }
    this.logger.info(
      { event: 'collab_left', documentId, workspaceId },
      'collab_left',
    );
  }

  /** Conservative eviction: persist final state, then drop the in-memory
   * session, but only after a grace period with zero connections - a quick
   * reconnect (join cancels this) reuses the live session instead. */
  private scheduleEviction(documentId: string): void {
    this.collaboration.scheduleEviction(
      documentId,
      evictionGraceMs(),
      async () => {
        const docSession = this.collaboration.getSession(documentId);
        if (docSession) {
          await this.persistence.flush(
            documentId,
            Y.encodeStateAsUpdate(docSession.ydoc),
          );
        }
        this.collaboration.evictSession(documentId);
        this.metrics.collabSessionEvictedTotal.inc();
        this.logger.info(
          { event: 'collab_session_evicted', documentId },
          'collab_session_evicted',
        );
      },
    );
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workspaceId?: string; documentId?: string },
  ): Promise<void> {
    const user = data(client).user;
    if (!user) {
      this.rejectConnection(client, 'not_authenticated');
      return;
    }

    const workspaceId = body?.workspaceId;
    const documentId = body?.documentId;
    if (!workspaceId || !documentId) {
      client.emit('join-error', {
        message: 'workspaceId and documentId are required',
      });
      return;
    }

    // 1. authenticated - already true (handleConnection required a valid JWT)
    // 2. workspace membership
    const membership = await this.members.findOne({
      where: { workspaceId, userId: user.sub },
    });
    if (!membership) {
      this.metrics.collabConnectionErrorsTotal.inc({ reason: 'not_member' });
      client.emit('join-error', { message: 'Document not found' });
      client.disconnect(true);
      return;
    }

    // 3. document existence, scoped to this workspace (IDOR-safe, same as REST)
    let archivedAt: Date | null;
    try {
      const document = await this.documentsService.get(workspaceId, documentId);
      archivedAt = document.archivedAt;
    } catch {
      this.metrics.collabConnectionErrorsTotal.inc({
        reason: 'document_not_found',
      });
      client.emit('join-error', { message: 'Document not found' });
      client.disconnect(true);
      return;
    }

    // 4. document read/edit permission - VIEWER (or an archived document, for
    // everyone) may join and receive updates, but never publish edits.
    const canEdit =
      this.permissions.canEditDocument(membership.role) && !archivedAt;
    data(client).session = { workspaceId, documentId, canEdit };

    // A client reconnecting inside the grace period reuses the still-live
    // session - cancel any pending eviction before it fires.
    this.collaboration.cancelEviction(documentId);

    const roomName = roomFor(documentId);
    await client.join(roomName);

    const wasEmpty = this.collaboration.isSessionEmpty(documentId);
    const session = await this.getOrCreateHydratedSession(documentId, roomName);
    this.collaboration.registerConnection(documentId, client.id);

    this.metrics.collabConnectionsCurrent.inc();
    if (wasEmpty) {
      this.metrics.collabSessionsCurrent.inc();
    }

    const profile = await this.usersService.findById(user.sub);
    const displayName = profile
      ? `${profile.firstName} ${profile.lastName}`.trim()
      : user.email;

    client.emit('joined', {
      documentId,
      canEdit,
      role: membership.role,
      self: { id: user.sub, name: displayName },
    });
    client.emit(
      'sync-update',
      Buffer.from(Y.encodeStateAsUpdate(session.ydoc)),
    );

    const existingClientIds = Array.from(session.awareness.getStates().keys());
    if (existingClientIds.length > 0) {
      client.emit(
        'awareness-update',
        Buffer.from(
          encodeAwarenessUpdate(session.awareness, existingClientIds),
        ),
      );
    }

    this.logger.info(
      { event: 'collab_joined', documentId, workspaceId, canEdit },
      'collab_joined',
    );
  }

  @SubscribeMessage('sync-update')
  handleSyncUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() update: Buffer,
  ): void {
    const session = data(client).session;
    if (!session) return;

    if (!session.canEdit) {
      this.metrics.collabConnectionErrorsTotal.inc({
        reason: 'forbidden_edit',
      });
      client.emit('update-rejected', { reason: 'read-only' });
      return;
    }

    const docSession = this.collaboration.getSession(session.documentId);
    if (!docSession) return;

    Y.applyUpdate(docSession.ydoc, new Uint8Array(update), client.id);
    client.to(roomFor(session.documentId)).emit('sync-update', update);
    this.metrics.crdtUpdatesTotal.inc();

    // Trailing-throttled: many rapid edits collapse into one write, but a
    // continuously-edited document still gets flushed periodically.
    this.persistence.scheduleFlush(session.documentId, () =>
      Y.encodeStateAsUpdate(docSession.ydoc),
    );
  }

  @SubscribeMessage('awareness-update')
  handleAwarenessUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() update: Buffer,
  ): void {
    const session = data(client).session;
    if (!session) return;

    const docSession = this.collaboration.getSession(session.documentId);
    if (!docSession) return;

    applyAwarenessUpdate(
      docSession.awareness,
      new Uint8Array(update),
      client.id,
    );
  }

  /**
   * Replaces a document's live content with `sourceState` (a previously
   * persisted version's bytes), broadcasts the resulting diff to every
   * connected client, and schedules a flush so the restored state survives
   * even if everyone then disconnects. Used by the version-restore REST
   * flow - this is the only place server-initiated content mutation
   * happens, as opposed to relaying a client's own `sync-update`.
   */
  async applyRestoredState(
    documentId: string,
    sourceState: Uint8Array,
  ): Promise<void> {
    const roomName = roomFor(documentId);
    const session = await this.getOrCreateHydratedSession(documentId, roomName);

    const before = Y.encodeStateVector(session.ydoc);
    const sourceDoc = decodeState(sourceState);
    replaceBlocksContent(session.ydoc, sourceDoc);
    const diff = Y.encodeStateAsUpdate(session.ydoc, before);

    this.server.to(roomName).emit('sync-update', Buffer.from(diff));
    this.persistence.scheduleFlush(documentId, () =>
      Y.encodeStateAsUpdate(session.ydoc),
    );

    this.logger.info(
      { event: 'collab_state_restored', documentId },
      'collab_state_restored',
    );
  }

  /** Gets-or-creates a document's in-memory session, hydrating it from
   * durable storage the first time this process sees it (not on every
   * join - only when the session doesn't already exist in memory). */
  private async getOrCreateHydratedSession(
    documentId: string,
    roomName: string,
  ): Promise<DocumentSession> {
    const isNewSession = !this.collaboration.getSession(documentId);

    const session = this.collaboration.getOrCreateSession(
      documentId,
      (changes, origin) => {
        const changedIds = [
          ...changes.added,
          ...changes.updated,
          ...changes.removed,
        ];
        if (changedIds.length === 0) return;
        if (typeof origin === 'string') {
          this.collaboration.trackAwarenessClients(documentId, origin, [
            ...changes.added,
            ...changes.updated,
          ]);
        }
        const update = Buffer.from(
          encodeAwarenessUpdate(session.awareness, changedIds),
        );
        this.server.to(roomName).emit('awareness-update', update);
      },
    );

    if (isNewSession) {
      const persisted = await this.persistence.hydrate(documentId);
      if (persisted) {
        Y.applyUpdate(session.ydoc, persisted, 'persistence');
        this.metrics.collabSessionHydratedTotal.inc();
        this.logger.info(
          { event: 'collab_session_hydrated', documentId },
          'collab_session_hydrated',
        );
      }
    }

    return session;
  }

  private rejectConnection(client: Socket, reason: string): void {
    this.metrics.collabConnectionErrorsTotal.inc({ reason });
    client.emit('join-error', { message: 'Unauthorized' });
    client.disconnect(true);
  }
}
