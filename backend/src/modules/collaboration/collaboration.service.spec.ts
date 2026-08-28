import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import * as Y from 'yjs';
import { CollaborationService } from './collaboration.service';

describe('CollaborationService', () => {
  const services: CollaborationService[] = [];

  function buildService(): CollaborationService {
    const service = new CollaborationService();
    services.push(service);
    return service;
  }

  afterEach(() => {
    // Awareness runs a 30s setInterval per session to expire stale clients -
    // destroy it here so Jest doesn't report an open handle after each test.
    for (const service of services.splice(0)) {
      for (const documentId of service.documentIds()) {
        service.getSession(documentId)?.awareness.destroy();
      }
    }
  });

  it('creates one session per documentId and reuses it on subsequent calls', () => {
    const service = buildService();
    const noop = jest.fn();

    const first = service.getOrCreateSession('doc-1', noop);
    const second = service.getOrCreateSession('doc-1', noop);
    const other = service.getOrCreateSession('doc-2', noop);

    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(service.activeSessionCount()).toBe(2);
  });

  it('only attaches the awareness listener on first creation', () => {
    const service = buildService();
    const firstListener = jest.fn();
    const secondListener = jest.fn();

    const session = service.getOrCreateSession('doc-1', firstListener);
    service.getOrCreateSession('doc-1', secondListener);

    session.awareness.setLocalState({ user: { id: 'u1' } });

    expect(firstListener).toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();
  });

  it('a document with no registered connections is empty', () => {
    const service = buildService();
    service.getOrCreateSession('doc-1', jest.fn());

    expect(service.isSessionEmpty('doc-1')).toBe(true);
  });

  it('registering a connection makes the session non-empty even with no awareness activity', () => {
    const service = buildService();
    service.getOrCreateSession('doc-1', jest.fn());
    service.registerConnection('doc-1', 'socket-a');

    expect(service.isSessionEmpty('doc-1')).toBe(false);
  });

  it('a document with no session at all is considered empty', () => {
    const service = buildService();
    expect(service.isSessionEmpty('never-created')).toBe(true);
  });

  it('tracks which awareness clientIDs a socket published, for later cleanup', () => {
    const service = buildService();
    const session = service.getOrCreateSession('doc-1', jest.fn());
    service.registerConnection('doc-1', 'socket-a');

    service.trackAwarenessClients('doc-1', 'socket-a', [
      session.awareness.clientID,
    ]);

    const removed = service.removeConnection('doc-1', 'socket-a');
    expect(removed).toEqual([session.awareness.clientID]);
  });

  it('removeConnection clears only the given socket, leaving the session and other sockets intact', () => {
    const service = buildService();
    service.getOrCreateSession('doc-1', jest.fn());
    service.registerConnection('doc-1', 'socket-a');
    service.registerConnection('doc-1', 'socket-b');

    service.removeConnection('doc-1', 'socket-a');

    expect(service.isSessionEmpty('doc-1')).toBe(false); // socket-b remains
  });

  it('removeConnection on an unknown document is a safe no-op', () => {
    const service = buildService();
    expect(service.removeConnection('never-created', 'socket-a')).toEqual([]);
  });

  it('removing awareness states for a disconnected socket broadcasts via the update event', () => {
    const service = buildService();
    const changes: unknown[] = [];
    const session = service.getOrCreateSession('doc-1', (change) =>
      changes.push(change),
    );
    service.registerConnection('doc-1', 'socket-a');

    // Simulate the remote client publishing presence, then disconnecting.
    const remoteDoc = new Y.Doc();
    const update = encodeAwarenessUpdate(
      Object.assign(Object.create(Object.getPrototypeOf(session.awareness)), {
        doc: remoteDoc,
        clientID: 999,
        states: new Map([[999, { user: { id: 'remote' } }]]),
        meta: new Map([[999, { clock: 1, lastUpdated: Date.now() }]]),
      }),
      [999],
    );
    applyAwarenessUpdate(session.awareness, update, 'socket-a');
    service.trackAwarenessClients('doc-1', 'socket-a', [999]);

    changes.length = 0;
    service.removeConnection('doc-1', 'socket-a');

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ removed: [999] });
  });

  describe('session eviction', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('evicts a session only after the grace period elapses', () => {
      jest.useFakeTimers();
      const service = buildService();
      service.getOrCreateSession('doc-1', jest.fn());
      const onEvict = jest.fn();

      service.scheduleEviction('doc-1', 1000, onEvict);
      jest.advanceTimersByTime(999);
      expect(onEvict).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(onEvict).toHaveBeenCalledTimes(1);
    });

    it('cancelEviction prevents a scheduled eviction from running', () => {
      jest.useFakeTimers();
      const service = buildService();
      service.getOrCreateSession('doc-1', jest.fn());
      const onEvict = jest.fn();

      service.scheduleEviction('doc-1', 1000, onEvict);
      service.cancelEviction('doc-1');
      jest.advanceTimersByTime(5000);

      expect(onEvict).not.toHaveBeenCalled();
    });

    it('scheduling eviction again for the same document replaces the previous timer (a rejoin resets the grace period)', () => {
      jest.useFakeTimers();
      const service = buildService();
      service.getOrCreateSession('doc-1', jest.fn());
      const firstOnEvict = jest.fn();
      const secondOnEvict = jest.fn();

      service.scheduleEviction('doc-1', 1000, firstOnEvict);
      jest.advanceTimersByTime(500);
      service.scheduleEviction('doc-1', 1000, secondOnEvict); // e.g. client reconnected then left again
      jest.advanceTimersByTime(999);
      expect(secondOnEvict).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(secondOnEvict).toHaveBeenCalledTimes(1);
      expect(firstOnEvict).not.toHaveBeenCalled();
    });

    it('evictSession removes the session and destroys its awareness instance', () => {
      const service = buildService();
      const session = service.getOrCreateSession('doc-1', jest.fn());
      const destroySpy = jest.spyOn(session.awareness, 'destroy');

      service.evictSession('doc-1');

      expect(destroySpy).toHaveBeenCalled();
      expect(service.getSession('doc-1')).toBeUndefined();
      expect(service.activeSessionCount()).toBe(0);
    });

    it('evictSession is a safe no-op for a document with no session', () => {
      const service = buildService();
      expect(() => service.evictSession('never-created')).not.toThrow();
    });

    it('hasScheduledEviction reflects pending eviction state', () => {
      jest.useFakeTimers();
      const service = buildService();
      service.getOrCreateSession('doc-1', jest.fn());

      expect(service.hasScheduledEviction('doc-1')).toBe(false);
      service.scheduleEviction('doc-1', 1000, jest.fn());
      expect(service.hasScheduledEviction('doc-1')).toBe(true);
      jest.advanceTimersByTime(1000);
      expect(service.hasScheduledEviction('doc-1')).toBe(false);
    });

    it('a fresh join after eviction creates a brand new session (not the destroyed one)', () => {
      const service = buildService();
      const original = service.getOrCreateSession('doc-1', jest.fn());
      service.evictSession('doc-1');

      const recreated = service.getOrCreateSession('doc-1', jest.fn());

      expect(recreated).not.toBe(original);
    });
  });
});
