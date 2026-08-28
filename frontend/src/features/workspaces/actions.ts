"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serverEnv } from "@/config/env";
import type { Invitation, Workspace } from "./types";

export interface InviteMemberActionState {
  status: "idle" | "success" | "error";
  message: string | null;
  invitation?: Invitation;
}

export const initialInviteMemberActionState: InviteMemberActionState = {
  status: "idle",
  message: null,
};

/**
 * Server Action backing the "invite a member" form (TT gap 5 - Server
 * Actions for non-realtime settings mutations). Takes the caller's
 * already-issued access token as a plain bound argument rather than
 * reading/rotating the refresh-token cookie itself: this app's access
 * tokens are deliberately in-memory-only browser state, never a cookie
 * (see `05-frontend.md`), and a Server Action independently exchanging the
 * refresh cookie here would race the client's own `AuthProvider` refresh
 * cycle over the same rotating refresh token - the backend's reuse
 * detection would read that race as a replay and revoke every session for
 * the user. Passing the token through keeps this to the one request the
 * browser would have made anyway, with no new trust boundary and no
 * rotation risk, while still getting the real Server Action benefits:
 * server-side validation, a `useActionState`-driven pending/error UI with
 * no client-side fetch/try-catch boilerplate, and `revalidatePath` for any
 * Server Component that later reads this workspace's data.
 *
 * Talks to `serverEnv.backendInternalUrl` (Docker-internal address),
 * unlike the rest of the app's authenticated calls which go straight from
 * the browser to `NEXT_PUBLIC_API_URL` - this call originates on the
 * server, so it uses the same internal/public split as every other
 * server-to-server call in this app (RevalidationService, `/p/[slug]`).
 */
export async function inviteMemberAction(
  accessToken: string,
  workspaceId: string,
  _prevState: InviteMemberActionState,
  formData: FormData,
): Promise<InviteMemberActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!email) {
    return { status: "error", message: "Email is required." };
  }
  if (!role) {
    return { status: "error", message: "Role is required." };
  }

  let res: Response;
  try {
    res = await fetch(
      `${serverEnv.backendInternalUrl}/api/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ email, role }),
      },
    );
  } catch {
    return { status: "error", message: "Could not reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return {
      status: "error",
      message: body?.message ?? "Failed to send invitation.",
    };
  }

  const invitation = (await res.json()) as Invitation;
  revalidatePath(`/workspace/${workspaceId}`);

  return { status: "success", message: null, invitation };
}

export interface CreateWorkspaceActionState {
  status: "idle" | "error";
  message: string | null;
}

export const initialCreateWorkspaceActionState: CreateWorkspaceActionState = {
  status: "idle",
  message: null,
};

/**
 * Server Action for the dashboard's "create workspace" form - on success
 * it redirects straight to the new workspace itself (`redirect()` inside a
 * Server Action is the standard Next.js pattern for "mutate, then
 * navigate"), so there's no client-side `router.push` after an awaited
 * fetch. Same token-passthrough rationale as `inviteMemberAction` above.
 */
export async function createWorkspaceAction(
  accessToken: string,
  _prevState: CreateWorkspaceActionState,
  formData: FormData,
): Promise<CreateWorkspaceActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { status: "error", message: "Workspace name is required." };
  }

  let res: Response;
  try {
    res = await fetch(`${serverEnv.backendInternalUrl}/api/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name }),
    });
  } catch {
    return { status: "error", message: "Could not reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return {
      status: "error",
      message: body?.message ?? "Failed to create workspace.",
    };
  }

  const workspace = (await res.json()) as Workspace;
  revalidatePath("/workspace");
  redirect(`/workspace/${workspace.id}`);
}
