"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Avatar, Badge, Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRequireAuth } from "@/features/auth/useRequireAuth";
import { formatPlanLimitMessage, isApiError, isPlanLimitError } from "@/lib/api-error";
import { acceptInvitationById, listMyInvitations, listWorkspaces, rejectInvitationById } from "./api";
import { createWorkspaceAction, initialCreateWorkspaceActionState } from "./actions";
import type { Invitation, Workspace } from "./types";
import styles from "./WorkspaceDashboard.module.css";

export function WorkspaceDashboard() {
  const { status } = useRequireAuth();

  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { apiFetch, getAccessToken } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // Server Action (TT gap 5) - see features/workspaces/actions.ts. On
  // success it redirects server-side straight to the new workspace, so
  // there's no client-side navigation branch to handle here at all.
  const [createState, createFormAction, creating] = useActionState(
    createWorkspaceAction.bind(null, getAccessToken() ?? ""),
    initialCreateWorkspaceActionState,
  );

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

  async function handleAccept(invitation: Invitation) {
    setActionError(null);
    setActioningId(invitation.id);
    try {
      await acceptInvitationById(apiFetch, invitation.id);
      reload();
    } catch (err) {
      // The member-limit check runs at accept time (see backend
      // InvitationsService.performAccept) - the invitee isn't the one who
      // can upgrade, so point them to the owner instead.
      if (isPlanLimitError(err)) {
        setActionError(
          formatPlanLimitMessage(err, "Ask the workspace owner to upgrade to PRO."),
        );
      } else {
        setActionError(isApiError(err) ? err.message : "Failed to accept invitation.");
      }
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
      <div className={styles.loadingPage}>
        <Spinner label="Loading your session" />
      </div>
    );
  }

  const pendingInvitations = invitations?.filter((i) => i.status === "pending") ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Workspaces</h1>
        <p className={styles.pageSubtitle}>Pick up where you left off, or start something new.</p>
      </header>

      {pendingInvitations.length > 0 || invitations === null ? (
        <section className={styles.section} aria-labelledby="invitations-heading">
          <h2 id="invitations-heading" className={styles.sectionTitle}>
            Pending invitations
          </h2>
          {actionError ? (
            <p className={styles.error} role="alert">
              {actionError}
            </p>
          ) : null}
          {invitations === null ? (
            <Spinner label="Loading invitations" />
          ) : (
            <div className={styles.invitationList}>
              {pendingInvitations.map((invitation) => (
                <Card key={invitation.id} padding="sm" className={styles.invitationRow}>
                  <div className={styles.invitationInfo}>
                    <Avatar name={invitation.workspaceName} size="sm" />
                    <div>
                      <div className={styles.workspaceName}>{invitation.workspaceName}</div>
                      <Badge variant="outline">Invited as {invitation.role}</Badge>
                    </div>
                  </div>
                  <div className={styles.invitationActions}>
                    <Button
                      size="sm"
                      onClick={() => handleAccept(invitation)}
                      disabled={actioningId === invitation.id}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleReject(invitation)}
                      disabled={actioningId === invitation.id}
                    >
                      Decline
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="workspaces-heading">
        <h2 id="workspaces-heading" className={styles.sectionTitle}>
          Your workspaces
        </h2>
        {loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : null}
        {workspaces === null ? (
          <Spinner label="Loading workspaces" />
        ) : workspaces.length === 0 ? (
          <EmptyState
            title="No workspaces yet"
            description="Create your first workspace below — you'll be its owner and can invite others once it exists."
          />
        ) : (
          <div className={styles.workspaceGrid}>
            {workspaces.map((workspace) => (
              <Link key={workspace.id} href={`/workspace/${workspace.id}`} className={styles.workspaceCard}>
                <Card interactive className={styles.workspaceCardInner}>
                  <Avatar name={workspace.name} />
                  <div className={styles.workspaceCardBody}>
                    <div className={styles.workspaceName}>{workspace.name}</div>
                    <Badge variant="neutral">{workspace.role}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <form className={styles.createForm} action={createFormAction}>
          <Input name="name" aria-label="New workspace name" placeholder="New workspace name" />
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create workspace"}
          </Button>
        </form>
        {createState.status === "error" ? (
          <p className={styles.error} role="alert">
            {createState.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
