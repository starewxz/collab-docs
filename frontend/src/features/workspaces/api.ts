import type { Invitation, Member, Workspace, WorkspaceRole } from "./types";

/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export function listWorkspaces(apiFetch: ApiFetch): Promise<Workspace[]> {
  return apiFetch<Workspace[]>("/api/workspaces");
}

export function createWorkspace(
  apiFetch: ApiFetch,
  name: string,
): Promise<Workspace> {
  return apiFetch<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getWorkspace(
  apiFetch: ApiFetch,
  workspaceId: string,
): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${workspaceId}`);
}

export function listMembers(
  apiFetch: ApiFetch,
  workspaceId: string,
): Promise<Member[]> {
  return apiFetch<Member[]>(`/api/workspaces/${workspaceId}/members`);
}

export function changeMemberRole(
  apiFetch: ApiFetch,
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole,
): Promise<Member> {
  return apiFetch<Member>(`/api/workspaces/${workspaceId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function removeMember(
  apiFetch: ApiFetch,
  workspaceId: string,
  memberId: string,
): Promise<void> {
  return apiFetch<void>(`/api/workspaces/${workspaceId}/members/${memberId}`, {
    method: "DELETE",
  });
}

export function leaveWorkspace(
  apiFetch: ApiFetch,
  workspaceId: string,
): Promise<void> {
  return apiFetch<void>(`/api/workspaces/${workspaceId}/members/me`, {
    method: "DELETE",
  });
}

export function inviteMember(
  apiFetch: ApiFetch,
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<Invitation> {
  return apiFetch<Invitation>(`/api/workspaces/${workspaceId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export function listWorkspaceInvitations(
  apiFetch: ApiFetch,
  workspaceId: string,
): Promise<Invitation[]> {
  return apiFetch<Invitation[]>(`/api/workspaces/${workspaceId}/invitations`);
}

export function listMyInvitations(apiFetch: ApiFetch): Promise<Invitation[]> {
  return apiFetch<Invitation[]>("/api/invitations/me");
}

/** For the emailed-link flow: /invitations/[token] page. */
export function acceptInvitation(
  apiFetch: ApiFetch,
  token: string,
): Promise<{ workspaceId: string }> {
  return apiFetch<{ workspaceId: string }>(`/api/invitations/${token}/accept`, {
    method: "POST",
  });
}

export function rejectInvitation(
  apiFetch: ApiFetch,
  token: string,
): Promise<{ success: true }> {
  return apiFetch<{ success: true }>(`/api/invitations/${token}/reject`, {
    method: "POST",
  });
}

/** For the dashboard's "Pending Invitations" list, driven by /invitations/me. */
export function acceptInvitationById(
  apiFetch: ApiFetch,
  invitationId: string,
): Promise<{ workspaceId: string }> {
  return apiFetch<{ workspaceId: string }>(
    `/api/invitations/by-id/${invitationId}/accept`,
    { method: "POST" },
  );
}

export function rejectInvitationById(
  apiFetch: ApiFetch,
  invitationId: string,
): Promise<{ success: true }> {
  return apiFetch<{ success: true }>(
    `/api/invitations/by-id/${invitationId}/reject`,
    { method: "POST" },
  );
}
