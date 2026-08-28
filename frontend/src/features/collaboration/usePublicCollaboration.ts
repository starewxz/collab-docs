import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { applyAwarenessUpdate, Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { publicEnv } from "@/config/env";
import type { CollabJoinedPayload } from "./types";

const REMOTE_ORIGIN = "remote";

export type PublicCollabStatus = "connecting" | "connected" | "disconnected" | "error";

export interface PublicCollaborationState {
  status: PublicCollabStatus;
  canEdit: boolean;
  error: string | null;
  ydoc: Y.Doc;
}

/**
 * Anonymous counterpart to `useCollaboration` (TT gap 2: public
 * edit-by-link) - connects to the same `/collab` gateway but with no JWT
 * and emits `join-public` (slug-scoped) instead of `join`
 * (workspace/document-id-scoped, requires membership). The backend
 * (`CollaborationGateway.handlePublicJoin`) only admits this for a
 * document that is published with `publicAccessMode: 'edit'` and not
 * expired, and the resulting session can only ever touch that one
 * document - see the gateway's docstring.
 *
 * Deliberately a separate hook rather than a `useCollaboration` option:
 * the two auth models (JWT-scoped vs slug-scoped) don't share enough
 * (no role, no presence-by-user-id, no reconnect-with-token) to make a
 * shared implementation clearer than two small focused ones.
 */
export function usePublicCollaboration(slug: string): PublicCollaborationState {
  const [status, setStatus] = useState<PublicCollabStatus>("connecting");
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ydoc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(ydoc));

  useEffect(() => {
    const socket: Socket = io(`${publicEnv.apiUrl}/collab`, {
      transports: ["websocket"],
    });

    function handleConnect() {
      socket.emit("join-public", { slug });
    }

    function handleJoined(payload: CollabJoinedPayload) {
      setCanEdit(payload.canEdit);
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
      if (origin === REMOTE_ORIGIN) return;
      socket.emit("sync-update", update);
    }

    socket.on("connect", handleConnect);
    socket.on("joined", handleJoined);
    socket.on("join-error", handleJoinError);
    socket.on("sync-update", handleSyncUpdate);
    socket.on("awareness-update", handleAwarenessUpdate);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    ydoc.on("update", handleLocalDocUpdate);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("joined", handleJoined);
      socket.off("join-error", handleJoinError);
      socket.off("sync-update", handleSyncUpdate);
      socket.off("awareness-update", handleAwarenessUpdate);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      ydoc.off("update", handleLocalDocUpdate);
      socket.disconnect();
    };
  }, [slug, ydoc, awareness]);

  return { status, canEdit, error, ydoc };
}
