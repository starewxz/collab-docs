import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { publicEnv } from "@/config/env";
import { useAuth } from "@/features/auth/AuthProvider";
import { colorForUserId } from "./color";
import type { CollabJoinedPayload, PresenceUser } from "./types";

const REMOTE_ORIGIN = "remote";

export type CollabConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface CollaborationState {
  status: CollabConnectionStatus;
  canEdit: boolean;
  role: string | null;
  error: string | null;
  collaborators: PresenceUser[];
  ydoc: Y.Doc;
  awareness: Awareness;
}

/**
 * Owns the whole live-collaboration lifecycle for one document: the
 * socket.io connection to the `/collab` gateway, the shared Y.Doc + Yjs
 * Awareness instance, and translating between local edits/socket.io events.
 *
 * The Y.Doc and Awareness are created once per (workspaceId, documentId)
 * and kept alive across reconnects - `Y.applyUpdate` is idempotent, so a
 * dropped connection never loses local edits made while offline; rejoining
 * just merges in whatever the server has that this client doesn't yet.
 */
export function useCollaboration(workspaceId: string, documentId: string): CollaborationState {
  const { status: authStatus, getAccessToken } = useAuth();
  const [status, setStatus] = useState<CollabConnectionStatus>("connecting");
  const [canEdit, setCanEdit] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<PresenceUser[]>([]);

  // Lazy useState initializers (not refs) - these need to be stable, readable
  // during render, and created exactly once per mount, which is exactly what
  // useState guarantees; refs are for effect-only mutable state instead.
  const [ydoc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(ydoc));

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const token = getAccessToken();
    if (!token) return;

    // Status starts at "connecting" (initial state) and transitions purely
    // in response to the socket's own events below - no eager reset here,
    // so a documentId change reuses the last known status until the new
    // socket's first event arrives instead of an extra synchronous render.
    const socket: Socket = io(`${publicEnv.apiUrl}/collab`, {
      auth: { token },
      transports: ["websocket"],
    });

    function refreshCollaborators() {
      const list: PresenceUser[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // exclude self
        const user = (state as { user?: { id: string; name: string } } | undefined)?.user;
        if (user) {
          list.push({ id: user.id, name: user.name, color: colorForUserId(user.id) });
        }
      });
      setCollaborators(list);
    }

    function handleConnect() {
      socket.emit("join", { workspaceId, documentId });
    }

    function handleJoined(payload: CollabJoinedPayload) {
      awareness.setLocalStateField("user", payload.self);
      setCanEdit(payload.canEdit);
      setRole(payload.role);
      setStatus("connected");
      setError(null);
    }

    function handleJoinError(payload: { message: string }) {
      setStatus("error");
      setError(payload.message);
    }

    function handleSyncUpdate(update: ArrayBuffer) {
      Y.applyUpdate(ydoc, new Uint8Array(update), REMOTE_ORIGIN);
    }

    function handleAwarenessUpdate(update: ArrayBuffer) {
      applyAwarenessUpdate(awareness, new Uint8Array(update), REMOTE_ORIGIN);
    }

    function handleDisconnect() {
      setStatus("disconnected");
    }

    function handleConnectError(err: Error) {
      setStatus("error");
      setError(err.message);
    }

    function handleLocalDocUpdate(update: Uint8Array, origin: unknown) {
      if (origin === REMOTE_ORIGIN) return; // don't echo back what we just applied
      socket.emit("sync-update", update);
    }

    function handleLocalAwarenessUpdate(
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) {
      if (origin === REMOTE_ORIGIN) return;
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;
      socket.emit("awareness-update", encodeAwarenessUpdate(awareness, changed));
    }

    socket.on("connect", handleConnect);
    socket.on("joined", handleJoined);
    socket.on("join-error", handleJoinError);
    socket.on("sync-update", handleSyncUpdate);
    socket.on("awareness-update", handleAwarenessUpdate);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    awareness.on("change", refreshCollaborators);
    ydoc.on("update", handleLocalDocUpdate);
    awareness.on("update", handleLocalAwarenessUpdate);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("joined", handleJoined);
      socket.off("join-error", handleJoinError);
      socket.off("sync-update", handleSyncUpdate);
      socket.off("awareness-update", handleAwarenessUpdate);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      awareness.off("change", refreshCollaborators);
      ydoc.off("update", handleLocalDocUpdate);
      awareness.off("update", handleLocalAwarenessUpdate);
      // The server independently detects this disconnect and cleans up
      // presence for us (see backend CollaborationGateway.handleDisconnect) -
      // no need to race an explicit "leaving" broadcast against teardown.
      socket.disconnect();
    };
  }, [authStatus, workspaceId, documentId, getAccessToken, ydoc, awareness]);

  return {
    status,
    canEdit,
    role,
    error,
    collaborators,
    ydoc,
    awareness,
  };
}
