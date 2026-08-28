import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';

export type AwarenessChangeHandler = (
  changes: { added: number[]; updated: number[]; removed: number[] },
  origin: unknown,
) => void;

export interface DocumentSession {
  ydoc: Y.Doc;
  awareness: Awareness;
  /** socket.io socket id -> awareness clientIDs it has published, so a
   * disconnect can clean up exactly the states that socket owns. */
  connections: Map<string, Set<number>>;
}

/**
 * In-memory Yjs session registry: one Y.Doc + Awareness per actively-open
 * document, for the lifetime of this server process only. Deliberately NOT
 * persisted to Postgres - Stage 5 owns durable CRDT storage/snapshots. If
 * this process restarts, all in-flight collaborative state is lost; only
 * currently-connected clients' merged edits survive within a process.
 */
@Injectable()
export class CollaborationService implements OnModuleDestroy {
  private readonly sessions = new Map<string, DocumentSession>();
  private readonly evictionTimers = new Map<string, NodeJS.Timeout>();

  /** Awareness runs an internal setInterval to expire stale clients - without
   * this, the process (and any e2e test host) would never exit cleanly. */
  onModuleDestroy(): void {
    for (const timer of this.evictionTimers.values()) {
      clearTimeout(timer);
    }
    this.evictionTimers.clear();
    for (const session of this.sessions.values()) {
      session.awareness.destroy();
    }
    this.sessions.clear();
  }

  getOrCreateSession(
    documentId: string,
    onAwarenessChange: AwarenessChangeHandler,
  ): DocumentSession {
    let session = this.sessions.get(documentId);
    if (!session) {
      const ydoc = new Y.Doc();
      const awareness = new Awareness(ydoc);
      awareness.on('update', onAwarenessChange);
      session = { ydoc, awareness, connections: new Map() };
      this.sessions.set(documentId, session);
    }
    return session;
  }

  getSession(documentId: string): DocumentSession | undefined {
    return this.sessions.get(documentId);
  }

  /** Marks a socket as connected to this document's session, independent of
   * whether it has published any awareness state yet - this is what
   * `isSessionEmpty` counts, so a joined-but-silent client still keeps the
   * session (and its metrics) alive. */
  registerConnection(documentId: string, socketId: string): void {
    const session = this.sessions.get(documentId);
    if (!session) return;
    if (!session.connections.has(socketId)) {
      session.connections.set(socketId, new Set());
    }
  }

  trackAwarenessClients(
    documentId: string,
    socketId: string,
    clientIds: number[],
  ): void {
    const session = this.sessions.get(documentId);
    if (!session || clientIds.length === 0) return;
    const set = session.connections.get(socketId) ?? new Set<number>();
    clientIds.forEach((id) => set.add(id));
    session.connections.set(socketId, set);
  }

  /** Cleans up a disconnected socket's awareness states. Returns the
   * clientIDs that were removed (empty if the socket had none/wasn't known). */
  removeConnection(documentId: string, socketId: string): number[] {
    const session = this.sessions.get(documentId);
    if (!session) return [];
    const clientIds = Array.from(session.connections.get(socketId) ?? []);
    session.connections.delete(socketId);
    if (clientIds.length > 0) {
      removeAwarenessStates(session.awareness, clientIds, socketId);
    }
    return clientIds;
  }

  isSessionEmpty(documentId: string): boolean {
    const session = this.sessions.get(documentId);
    return !session || session.connections.size === 0;
  }

  activeSessionCount(): number {
    return this.sessions.size;
  }

  documentIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Schedules eviction after a grace period rather than immediately on the
   * last disconnect - conservative, so a client that reconnects quickly
   * (e.g. a brief network drop) reuses the still-live session instead of
   * forcing a full rehydrate. `onEvict` is expected to persist final state
   * before this class removes the session from memory. */
  scheduleEviction(
    documentId: string,
    delayMs: number,
    onEvict: () => void | Promise<void>,
  ): void {
    this.cancelEviction(documentId);
    const timer = setTimeout(() => {
      this.evictionTimers.delete(documentId);
      void onEvict();
    }, delayMs);
    timer.unref?.();
    this.evictionTimers.set(documentId, timer);
  }

  cancelEviction(documentId: string): void {
    const timer = this.evictionTimers.get(documentId);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(documentId);
    }
  }

  hasScheduledEviction(documentId: string): boolean {
    return this.evictionTimers.has(documentId);
  }

  /** Removes a document's session from memory, destroying its Awareness
   * instance (stopping its interval timer). The caller must have already
   * persisted whatever state needs to survive this - eviction itself never
   * touches storage. */
  evictSession(documentId: string): void {
    const session = this.sessions.get(documentId);
    if (session) {
      session.awareness.destroy();
      this.sessions.delete(documentId);
    }
    this.cancelEviction(documentId);
  }
}
