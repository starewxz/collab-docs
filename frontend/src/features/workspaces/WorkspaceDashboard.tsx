"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRequireAuth } from "@/features/auth/useRequireAuth";
import { isApiError } from "@/lib/api-error";
import {
  acceptInvitationById,
  createWorkspace,
  listMyInvitations,
  listWorkspaces,
  rejectInvitationById,
} from "./api";
import type { Invitation, Workspace } from "./types";
import styles from "./WorkspaceDashboard.module.css";

export function WorkspaceDashboard() {
  const { status } = useRequireAuth();
  const router = useRouter();

  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { apiFetch } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    Promise.all([listWorkspaces(apiFetch), listMyInvitations(apiFetch)])
      .then(([ws, inv]) => {
        if (cancelled) return;
        setWorkspaces(ws);
        setInvitations(inv);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(isApiError(err) ? err.message : "Failed to load your workspaces.");
      });
    return () => {
      cancelled = true;
    };
  }, [status, apiFetch, reloadKey]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    if (!newWorkspaceName.trim()) {
      setCreateError("Workspace name is required.");
      return;
    }
    setCreating(true);
    try {
      const workspace = await createWorkspace(apiFetch, newWorkspaceName.trim());
      setNewWorkspaceName("");
      router.push(`/workspace/${workspace.id}`);
    } catch (err) {
      setCreateError(isApiError(err) ? err.message : "Failed to create workspace.");
    } finally {
      setCreating(false);
    }
  }

  async function handleAccept(invitation: Invitation) {
    setActionError(null);
    setActioningId(invitation.id);
    try {
      await acceptInvitationById(apiFetch, invitation.id);
      reload();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to accept invitation.");
    } finally {
      setActioningId(null);
    }
  }

  async function handleReject(invitation: Invitation) {
    setActionError(null);
    setActioningId(invitation.id);
    try {
      await rejectInvitationById(apiFetch, invitation.id);
      reload();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : "Failed to reject invitation.");
    } finally {
      setActioningId(null);
    }
  }

  if (status === "loading") {
    return (
      <div className={styles.page}>
        <Spinner label="Loading your session" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>My Workspaces</h2>
        {loadError ? <p className={styles.error}>{loadError}</p> : null}
        {workspaces === null ? (
          <Spinner label="Loading workspaces" />
        ) : workspaces.length === 0 ? (
          <EmptyState title="No workspaces yet" description="Create one below to get started." />
        ) : (
          <div className={styles.workspaceList}>
            {workspaces.map((workspace) => (
              <Card key={workspace.id} className={styles.workspaceRow}>
                <div>
                  <Link href={`/workspace/${workspace.id}`} className={styles.workspaceName}>
                    {workspace.name}
                  </Link>
                  <div className={styles.workspaceRole}>{workspace.role}</div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <form className={styles.createForm} onSubmit={handleCreate}>
          <Input
            placeholder="New workspace name"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
          />
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create Workspace"}
          </Button>
        </form>
        {createError ? <p className={styles.error}>{createError}</p> : null}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pending Invitations</h2>
        {actionError ? <p className={styles.error}>{actionError}</p> : null}
        {invitations === null ? (
          <Spinner label="Loading invitations" />
        ) : invitations.filter((i) => i.status === "pending").length === 0 ? (
          <EmptyState title="No pending invitations" />
        ) : (
          invitations
            .filter((i) => i.status === "pending")
            .map((invitation) => (
              <Card key={invitation.id} className={styles.invitationRow}>
                <div className={styles.invitationInfo}>
                  <span className={styles.workspaceName}>{invitation.workspaceName}</span>
                  <span className={styles.workspaceRole}>as {invitation.role}</span>
                </div>
                <div className={styles.invitationActions}>
                  <Button
                    onClick={() => handleAccept(invitation)}
                    disabled={actioningId === invitation.id}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleReject(invitation)}
                    disabled={actioningId === invitation.id}
                  >
                    Reject
                  </Button>
                </div>
              </Card>
            ))
        )}
      </section>
    </div>
  );
}
