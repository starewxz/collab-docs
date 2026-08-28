"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar, Badge, Button, Card, EmptyState, Input, Select, Spinner, Tabs, useToast } from "@/components/ui";
import { UsersIcon } from "@/components/ui/icons";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRequireAuth } from "@/features/auth/useRequireAuth";
import { isApiError } from "@/lib/api-error";
import {
  initialInviteMemberActionState,
  inviteMemberAction,
  type InviteMemberActionState,
} from "./actions";

/** Billing/usage isn't needed for the members list above it to be usable -
 * splitting it into its own chunk keeps the workspace shell's first paint
 * lighter. */
const BillingSection = dynamic(
  () => import("@/features/billing/BillingSection").then((m) => m.BillingSection),
  { ssr: false, loading: () => <Spinner label="Loading billing" /> },
);
import {
  changeMemberRole,
  getWorkspace,
  leaveWorkspace,
  listMembers,
  listWorkspaceInvitations,
  removeMember,
} from "./api";
import {
  ASSIGNABLE_ROLES,
  canChangeMemberRole,
  canInviteMembers,
  canLeaveWorkspace,
  canRemoveMember,
} from "./permissions";
import type { Invitation, Member, Workspace, WorkspaceRole } from "./types";
import styles from "./WorkspaceShell.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

const TABS = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "billing", label: "Billing" },
];

export function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  const { status } = useRequireAuth();
  const { apiFetch, getAccessToken } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("general");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("VIEWER");
  // Server Action (TT gap 5) - see features/workspaces/actions.ts for why
  // the access token is passed through as a bound argument instead of the
  // action reading the refresh cookie itself.
  const [inviteState, inviteFormAction, inviting] = useActionState(
    inviteMemberAction.bind(null, getAccessToken() ?? "", workspaceId),
    initialInviteMemberActionState,
  );

  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    Promise.all([getWorkspace(apiFetch, workspaceId), listMembers(apiFetch, workspaceId)])
      .then(([ws, mem]) => {
        if (cancelled) return;
        setWorkspace(ws);
        setMembers(mem);
        setLoadError(null);
        setNotFound(false);
        if (canInviteMembers(ws.role)) {
          listWorkspaceInvitations(apiFetch, workspaceId)
            .then((list) => {
              if (!cancelled) setInvitations(list);
            })
            .catch(() => undefined);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(isApiError(err) ? err.message : "Failed to load workspace.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, apiFetch, workspaceId, reloadKey]);

  // Reacts to the invite Server Action's result rather than awaiting it
  // inline - useActionState drives `inviteState` from the form submission
  // itself (see the "invitations" tab below). The ref guards against
  // re-firing on unrelated re-renders once a given success has already
  // been handled.
  const handledInviteStateRef = useRef<InviteMemberActionState | null>(null);
  useEffect(() => {
    if (inviteState.status === "success" && handledInviteStateRef.current !== inviteState) {
      handledInviteStateRef.current = inviteState;
      showToast(
        inviteState.invitation?.inviteUrl
          ? `Invitation created. Dev link: ${inviteState.invitation.inviteUrl}`
          : "Invitation sent.",
      );
      reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteState]);

  async function handleRoleChange(member: Member, role: WorkspaceRole) {
    setMemberActionError(null);
    try {
      await changeMemberRole(apiFetch, workspaceId, member.id, role);
      reload();
    } catch (err) {
      setMemberActionError(isApiError(err) ? err.message : "Failed to change role.");
    }
  }

  async function handleRemove(member: Member) {
    setMemberActionError(null);
    try {
      await removeMember(apiFetch, workspaceId, member.id);
      reload();
    } catch (err) {
      setMemberActionError(isApiError(err) ? err.message : "Failed to remove member.");
    }
  }

  async function handleLeave() {
    setMemberActionError(null);
    try {
      await leaveWorkspace(apiFetch, workspaceId);
      router.push("/workspace");
    } catch (err) {
      setMemberActionError(isApiError(err) ? err.message : "Failed to leave workspace.");
    }
  }

  if (status === "loading" || (!workspace && !notFound && !loadError)) {
    return (
      <div className={styles.loadingPage}>
        <Spinner label="Loading workspace" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Workspace not found"
          description="It may not exist, or you may not have access to it."
        />
      </div>
    );
  }

  if (loadError || !workspace) {
    return (
      <div className={styles.page}>
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  const myRole = workspace.role;
  const pendingInvitations = (invitations ?? []).filter((i) => i.status === "pending");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Avatar name={workspace.name} />
        <div>
          <h1 className={styles.title}>{workspace.name}</h1>
          <Badge variant="outline">{myRole}</Badge>
        </div>
      </header>

      <Tabs items={TABS} activeId={activeTab} onChange={setActiveTab} aria-label="Workspace settings" />

      {activeTab === "general" ? (
        <section className={styles.section}>
          <Card>
            <dl className={styles.infoGrid}>
              <div>
                <dt>Workspace name</dt>
                <dd>{workspace.name}</dd>
              </div>
              <div>
                <dt>Slug</dt>
                <dd>{workspace.slug}</dd>
              </div>
              <div>
                <dt>Your role</dt>
                <dd>{myRole}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(workspace.createdAt)}</dd>
              </div>
            </dl>
          </Card>
          {canLeaveWorkspace(myRole) ? (
            <Button variant="danger" size="sm" onClick={handleLeave}>
              Leave workspace
            </Button>
          ) : null}
        </section>
      ) : null}

      {activeTab === "members" ? (
        <section className={styles.section}>
          {memberActionError ? (
            <p className={styles.error} role="alert">
              {memberActionError}
            </p>
          ) : null}
          {members === null ? (
            <Spinner label="Loading members" />
          ) : (
            <div className={styles.memberList}>
              {members.map((member) => (
                <Card key={member.id} padding="sm" className={styles.memberRow}>
                  <div className={styles.memberInfo}>
                    <Avatar name={`${member.firstName} ${member.lastName}`} size="sm" />
                    <div>
                      <div className={styles.memberName}>
                        {member.firstName} {member.lastName}
                      </div>
                      <div className={styles.memberEmail}>{member.email}</div>
                    </div>
                  </div>
                  <div className={styles.memberControls}>
                    {canChangeMemberRole(myRole, member.role) ? (
                      <Select
                        aria-label={`Change role for ${member.firstName} ${member.lastName}`}
                        value={member.role}
                        onChange={(e) => handleRoleChange(member, e.target.value as WorkspaceRole)}
                      >
                        {ASSIGNABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge variant="neutral">{member.role}</Badge>
                    )}
                    {canRemoveMember(myRole, member.role) ? (
                      <Button size="sm" variant="danger" onClick={() => handleRemove(member)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "invitations" ? (
        <section className={styles.section}>
          {canInviteMembers(myRole) ? (
            <Card>
              <form className={styles.inviteForm} action={inviteFormAction} key={reloadKey}>
                <Input
                  name="email"
                  type="email"
                  aria-label="Invitee email address"
                  placeholder="Email address"
                  defaultValue=""
                />
                <Select
                  name="role"
                  aria-label="Invitation role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                >
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" disabled={inviting}>
                  {inviting ? "Sending…" : "Send invite"}
                </Button>
              </form>
              {inviteState.status === "error" ? (
                <p className={styles.error} role="alert">
                  {inviteState.message}
                </p>
              ) : null}
              {inviteState.status === "success" && inviteState.invitation?.inviteUrl ? (
                <p className={styles.hint}>Dev link: {inviteState.invitation.inviteUrl}</p>
              ) : null}
            </Card>
          ) : null}

          {canInviteMembers(myRole) ? (
            invitations === null ? (
              <Spinner label="Loading invitations" />
            ) : pendingInvitations.length === 0 ? (
              <EmptyState
                icon={<UsersIcon width={20} height={20} />}
                title="No pending invitations"
                description="Invite someone above to add them to this workspace."
                compact
              />
            ) : (
              <div className={styles.memberList}>
                {pendingInvitations.map((invitation) => (
                  <Card key={invitation.id} padding="sm" className={styles.memberRow}>
                    <div className={styles.memberInfo}>
                      <Avatar name={invitation.email} size="sm" />
                      <div className={styles.memberEmail}>{invitation.email}</div>
                    </div>
                    <Badge variant="outline">Invited as {invitation.role}</Badge>
                  </Card>
                ))}
              </div>
            )
          ) : (
            <p className={styles.hint}>Only owners and admins can view invitations.</p>
          )}
        </section>
      ) : null}

      {activeTab === "billing" ? (
        <section className={styles.section}>
          <BillingSection workspaceId={workspaceId} role={myRole} />
        </section>
      ) : null}
    </div>
  );
}
