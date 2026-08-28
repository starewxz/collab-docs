"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRequireAuth } from "@/features/auth/useRequireAuth";
import { BillingSection } from "@/features/billing/BillingSection";
import { isApiError } from "@/lib/api-error";
import {
  changeMemberRole,
  getWorkspace,
  inviteMember,
  leaveWorkspace,
  listMembers,
  removeMember,
} from "./api";
import {
  ASSIGNABLE_ROLES,
  canChangeMemberRole,
  canInviteMembers,
  canLeaveWorkspace,
  canRemoveMember,
} from "./permissions";
import type { Member, Workspace, WorkspaceRole } from "./types";
import styles from "./WorkspaceShell.module.css";

export function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  const { status } = useRequireAuth();
  const { apiFetch } = useAuth();
  const router = useRouter();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("VIEWER");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

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

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setInviteMessage(null);
    if (!inviteEmail.trim()) {
      setInviteError("Email is required.");
      return;
    }
    setInviting(true);
    try {
      const invitation = await inviteMember(apiFetch, workspaceId, inviteEmail.trim(), inviteRole);
      setInviteEmail("");
      setInviteMessage(
        invitation.inviteUrl
          ? `Invitation created. Dev link: ${invitation.inviteUrl}`
          : "Invitation sent.",
      );
    } catch (err) {
      setInviteError(isApiError(err) ? err.message : "Failed to send invitation.");
    } finally {
      setInviting(false);
    }
  }

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
      <div className={styles.page}>
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
        <p className={styles.error}>{loadError}</p>
      </div>
    );
  }

  const myRole = workspace.role;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{workspace.name}</h1>
        <span className={styles.roleBadge}>{myRole}</span>
      </div>

      <BillingSection workspaceId={workspaceId} role={myRole} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Members</h2>
        {memberActionError ? <p className={styles.error}>{memberActionError}</p> : null}
        {members === null ? (
          <Spinner label="Loading members" />
        ) : (
          members.map((member) => (
            <Card key={member.id} className={styles.memberRow}>
              <div className={styles.memberInfo}>
                <span className={styles.memberName}>
                  {member.firstName} {member.lastName}
                </span>
                <span className={styles.memberEmail}>{member.email}</span>
              </div>
              <div className={styles.memberControls}>
                {canChangeMemberRole(myRole, member.role) ? (
                  <select
                    className={styles.roleSelect}
                    value={member.role}
                    onChange={(e) => handleRoleChange(member, e.target.value as WorkspaceRole)}
                  >
                    {ASSIGNABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={styles.hint}>{member.role}</span>
                )}
                {canRemoveMember(myRole, member.role) ? (
                  <Button variant="secondary" onClick={() => handleRemove(member)}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </Card>
          ))
        )}
        {canLeaveWorkspace(myRole) ? (
          <Button variant="ghost" onClick={handleLeave}>
            Leave workspace
          </Button>
        ) : null}
      </section>

      {canInviteMembers(myRole) ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Invite a member</h2>
          <form className={styles.inviteForm} onSubmit={handleInvite}>
            <Input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className={styles.roleSelect}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={inviting}>
              {inviting ? "Sending…" : "Invite"}
            </Button>
          </form>
          {inviteError ? <p className={styles.error}>{inviteError}</p> : null}
          {inviteMessage ? <p className={styles.hint}>{inviteMessage}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
