# Frontend

Next.js 16.3.3, App Router, React 19, TypeScript strict. **Server Components by default** — do not add blanket `'use client'` to layouts or page shells.

## Routes

| Route | Type | Notes |
|---|---|---|
| `/` | Server | Stage 1 connectivity check, not a real product page |
| `/login`, `/register` | Server page wrapping a Client form | `LoginForm`/`RegisterForm`, redirect to `?next=` after success |
| `/workspace` | Client (`WorkspaceDashboard`) | list workspaces, create workspace, pending invitations |
| `/workspace/[workspaceId]` | Client (`WorkspaceShell`) | members, invite, role change/remove, leave |
| `/workspace/[workspaceId]/document/[documentId]` | Client (`DocumentPage`) | breadcrumb, inline title rename, archived banner/restore, embeds `CollaborativeEditor` |
| `/invitations/[token]` | Client (`InvitationLinkPage`) | email-link accept/reject flow |
| `/p/[slug]` | Server (`PublicDocumentPage`, Stage 7) | **no auth** — SSR/ISR public document view, `generateMetadata` for SEO, 404 via `notFound()` for unpublished/nonexistent slugs |

`(auth)` and `(workspace)` are route groups (no URL effect). `proxy.ts` (Next 16's renamed `middleware.ts`) gates `/workspace/:path*` — redirects to `/login?next=...` if no `refresh_token` cookie. **This is a UX shortcut, not security** — the backend independently authorizes every call. `proxy.ts` also gates `/p/:path*` (Stage 7), but for a different reason: it checks document existence against the backend and returns a real 404 *before* the page renders — see the "Public sharing" section below for why this is required, not optional.

`workspace/[workspaceId]/layout.tsx` wraps both the workspace shell and every document route in a two-column layout with `DocumentSidebar`. Because layouts persist across nested navigations in the App Router, the sidebar's expand/collapse state survives clicking between documents without extra state-lifting.

## Why the dashboard/shell are Client Components

Next.js Server Components cannot set or rotate cookies, and the refresh token must rotate. Rather than fight that, authenticated data (workspaces, members, invitations) is fetched **client-side** after the page shell loads — "server shell + client data island". This is a deliberate Stage 2 decision (see `08-decisions.md`), not a default to imitate everywhere. Keep new Server Components server-rendered; only add `'use client'` where session data or interactivity is actually needed.

## Auth architecture

- `AuthProvider` (`features/auth/AuthProvider.tsx`, Client, wraps `{children}` in the root layout): holds `status` (`loading`/`authenticated`/`unauthenticated`), `user`, and an in-memory `accessToken` (`useRef`, never localStorage, lost on hard refresh).
- On mount: silently calls `POST /auth/refresh` (browser → backend directly, `credentials: 'include'`) to restore a session from the httpOnly cookie.
- `apiFetch<T>(path, options)`: attaches `Authorization: Bearer <token>`; on a 401, refreshes once and retries; if that also fails, flips to `unauthenticated`.
- `getAccessToken()`: exposes the same in-memory token raw, for the one caller that can't go through `apiFetch` - the collaboration WebSocket handshake (`useCollaboration`). Same lifetime/storage as before, just also readable directly.
- `useRequireAuth()` — redirects to `/login` client-side if status becomes `unauthenticated` (fallback for proxy.ts's cookie-only check missing an expired/revoked session).

## Realtime collaboration (Stage 4)

- `features/collaboration/useCollaboration.ts` — owns one socket.io connection (`${apiUrl}/collab`, `auth: {token}` from `getAccessToken()`) plus a `Y.Doc` and `y-protocols/awareness` `Awareness`, both created once via `useState(() => ...)` and kept alive across reconnects (never recreated by the hook itself, only by unmounting). Reconnect just re-emits `join` and merges the server's full-state resync - safe because Yjs update application is idempotent.
- `features/collaboration/blocks.ts` — the CRDT content model: `ydoc.getArray('blocks')` of `Y.Map`s, one per block, matching the 6 backend-agnostic block types (paragraph, heading, bulletListItem, checkbox, codeBlock, image).
- `features/collaboration/useYText.ts` / `textDiff.ts` — binds a block's `Y.Text` to a controlled `<textarea>` via prefix/suffix diffing (`computeTextDiff`, pure and unit-tested) instead of replacing the whole block on every keystroke. Built on `useSyncExternalStore`, not `useState`+`useEffect` - Yjs is exactly the external-mutable-store case that hook exists for, and avoids the "setState during effect" class of bugs.
- `features/collaboration/useYjsObserve.ts` — generic `useSyncExternalStore`-based re-render trigger for any Yjs shared type (used for the block list's own Y.Array and each block's Y.Map).
- `CollaborativeEditor`/`BlockView`/`PresenceBar` (`features/collaboration/`) — render the block list + presence bar; every mutation (`insertBlockAt`, `removeBlockAt`, text edits, checkbox toggle) is gated by `canEdit`, which comes from the server's `joined` ack, **not** a client-side guess — the gateway independently re-rejects any edit from a non-editor regardless of what the UI shows.

## Version history (Stage 5)

- `features/collaboration/versionsApi.ts` — plain `apiFetch`-first-arg wrappers for `listVersions`/`inspectVersion`/`createVersion`/`restoreVersion`, same pattern as the other `*/api.ts` files.
- `VersionHistoryPanel` (`features/collaboration/`) — a slide-over panel opened from `CollaborativeEditor`'s "History" toolbar button; lists versions (label/timestamp/author), inspects one as a read-only plain-block preview, and restores with an explicit confirmation step ("your current content will be saved as a new history entry first"). "Save current as version" and "Restore" are hidden unless `canEdit`; viewing history is available to any member.
- Restoring does **not** require a manual refresh of the editor - the backend broadcasts the resulting diff over the same `/collab` socket every connected client (including the one that triggered the restore) already has open, so content updates live through the existing `useCollaboration` sync path.

## Comments, notifications & attachments (Stage 6)

- `features/comments/api.ts` + `CommentsPanel.tsx` — same slide-over shape as `VersionHistoryPanel`, opened from `CollaborativeEditor`'s "Comments" toolbar button. Mentions are picked from a dropdown (backed by the existing `listMembers` call from `features/workspaces/api.ts`), never parsed out of free text — the composer tracks an explicit `mentionedUserIds: string[]` alongside the textarea value, shown as removable chips, and that array is exactly what's sent to the backend. `canComment`/`canModerateComments` (added to `features/workspaces/permissions.ts`, same UI-mirror pattern as the rest of that file) gate the compose/edit/delete/resolve controls; the backend is still the source of truth.
- `features/notifications/api.ts` + `NotificationsBell.tsx` — mounted in `WorkspaceSwitcher` (global top nav, not workspace-scoped, matching the backend route). Polls `unread-count` every 20s; the dropdown lazily fetches the full list only when opened. No deep-link from a notification to its document — the `NotificationResponseDto` doesn't carry `workspaceId`, and adding one wasn't required by the Stage 6 spec.
- `features/attachments/api.ts` + `AttachmentsPanel.tsx` — same panel shape again, opened from the "Files" toolbar button. Upload flow: `createUploadUrl` → raw (non-`apiFetch`) `fetch(uploadUrl, {method: 'PUT', body: file})` straight to the presigned MinIO URL → `confirmAttachment`. `uploadFileToPresignedUrl` is the one function in the whole frontend that deliberately bypasses `apiFetch`, since the presigned URL carries its own auth and isn't a backend call.
- All three panels are additive to `CollaborativeEditor`'s toolbar (`Comments` / `Files` / `History` buttons) — no change to the Stage 4/5 editor or version-history UI itself.

## Public sharing (Stage 7)

- `features/documents/PublishControl.tsx` — a small inline control on `DocumentPage` (not a slide-over panel like Comments/Files/History, since there's no list to browse): Publish/Unpublish buttons, the public URL (`${window.location.origin}/p/${slug}`, built client-side - no new env var needed), Copy link, Open. `publishDocument`/`unpublishDocument` added to `features/documents/api.ts`.
- `app/p/[slug]/page.tsx` — a plain **Server Component** (no `"use client"`). Fetches `${serverEnv.backendInternalUrl}/api/public/documents/:slug` with `next: {revalidate: 60, tags: [`public-doc-${slug}`]}`; calls `notFound()` on a 404. `generateMetadata` sets title/description (truncated first-block excerpt)/canonical/Open Graph/Twitter tags, and `{robots: {index: false}}` for the not-found case. `app/robots.ts` allows `/` and `/p/`, disallows the authenticated routes.
- `features/publishing/PublicDocumentView.tsx` — the **read-only** block renderer, a separate component from `BlockView` (no Yjs, no `canEdit`, no event handlers). Supports all Stage 4 block types; groups consecutive `bulletListItem`s into one `<ul>`. All text is rendered as plain JSX children (React's built-in escaping is the XSS defense - verified live with an actual `<script>`/`onerror` payload, which came back HTML-entity-escaped in the rendered page). `features/publishing/sanitize.ts`'s `isSafeUrl`/`sanitizeUrl` allowlist `http`/`https` schemes for the one attribute-position value in the block model (image `src`).
- `app/api/revalidate/route.ts` — a Route Handler the backend's `RevalidationService` calls after publish/unpublish/republish/archive, protected by a shared `REVALIDATE_SECRET` (server-only env var, never `NEXT_PUBLIC_*`). Calls `revalidateTag(tag, {expire: 0})` (Next 16 requires this two-argument form now - `{expire: 0}` forces the next request to be a blocking revalidate, the documented approach for invalidation triggered from outside a Server Action) and `revalidatePath` for both the literal slug path and the `/p/[slug]` page-pattern (the latter is the documented, more reliable way to invalidate a dynamic route).
- **Why `proxy.ts` also gates `/p/*`:** the app has a root `app/loading.tsx`, which wraps every route (this one included) in an implicit Suspense boundary. That means `/p/[slug]`'s own `notFound()` call only fires *after* the response shell has already streamed with a 200 status - Next.js cannot change the status code after streaming starts (this is documented Next.js 16 behavior, confirmed live: the page's content and `noindex` meta tag were correct, but curl still saw `200`). `proxy.ts` runs before any rendering, so it does the same existence check there and returns a real, pre-stream 404 when the backend says the slug doesn't resolve. See ADR-018.

## Search & billing (Stage 8)

- `features/search/SearchDialog.tsx` — a Cmd/Ctrl+K command dialog, mounted (conditionally, only while open) from `WorkspaceSwitcher` alongside a visible "Search" trigger button; the global keydown listener for the shortcut lives in `WorkspaceSwitcher` too, only attached while a `currentWorkspaceId` is derivable from the URL. Query is debounced (250ms) via a `useEffect`/`setTimeout` pair; results show title + snippet with keyboard nav (Arrow keys + Enter) and Escape/backdrop-click to close. The parent only renders `<SearchDialog>` while `searchOpen` is true (a fresh mount per open) rather than passing an `open` prop into an always-mounted component — this sidesteps a stricter React-hooks lint rule in this Next.js version (`react-hooks/set-state-in-effect`) against synchronously resetting state inside an effect just because a prop changed; a fresh mount already starts at the right defaults.
- **Snippet rendering is XSS-safe by construction**: `ts_headline`'s `<b>...</b>` markers are never passed through `dangerouslySetInnerHTML`. `renderSnippet()` splits the string on the literal `<b>`/`</b>` markers and renders each segment as a React text child (`<mark>`/`<span>`) — React's own escaping means any literal `<script>`/`onerror=` text a user actually typed into their document stays inert plain text, never parsed as HTML, regardless of what Postgres's `ts_headline` (which does **not** itself HTML-escape content) hands back.
- `features/search/api.ts` — `searchDocuments(apiFetch, workspaceId, query)`, same `apiFetch`-first-arg convention as every other `*/api.ts`.
- `features/billing/BillingSection.tsx` — embedded directly into the existing `WorkspaceShell` (the workspace's members/settings page), not a new route — this project's "do not redesign, keep it minimal" posture for Stage 8 UX. Shows plan badge/status/renewal date, usage bars for members/documents/storage (`null` limit renders as "Unlimited", no bar), and an Upgrade/Downgrade button gated by the new `canManageBilling` (OWNER-only, mirrors the backend's `assertCanManageWorkspaceSettings`) in `features/workspaces/permissions.ts`. Any member can view the section; only the owner sees the mutation button.
- `features/billing/api.ts` — `getSubscription`/`mockPay`/`downgradeToFree`. `checkout`/`createCheckoutSession` isn't wired up client-side — in mock mode there's no real hosted checkout page to redirect to, so the UI's only actionable "upgrade" path calls `mock-pay` directly (simulating the whole provider round trip); the backend endpoint exists purely as the seam a real Stripe integration would use later.
- **Upgrade-path messaging on `PLAN_LIMIT_EXCEEDED`**: `lib/api-error.ts` gained `isPlanLimitError()` (checks `error.body?.code === 'PLAN_LIMIT_EXCEEDED'`, using the extra structured fields the backend's `GlobalExceptionFilter` now preserves — see ADR-020). Used in three places instead of a generic failure message: `DocumentSidebar`'s create-document handlers ("Upgrade to PRO from the workspace settings page"), and `InvitationLinkPage`/`WorkspaceDashboard`'s accept-invitation handlers ("Ask the workspace owner to upgrade to PRO" — the invitee, not the owner, hits this error, since the member-limit check runs at accept time).

## API layer

- `lib/backend-fetch.ts` — unauthenticated calls (register/login/refresh/logout), `credentials: 'include'`, throws `ApiError` (status + body) on non-2xx.
- `features/auth/api.ts`, `features/workspaces/api.ts`, `features/documents/api.ts`, `features/comments/api.ts`, `features/notifications/api.ts`, `features/attachments/api.ts`, `features/search/api.ts`, `features/billing/api.ts` (Stage 8) — typed wrappers per endpoint. Functions take `apiFetch` as a parameter (from `useAuth()`) rather than importing React — keeps them plain and unit-testable. (The Stage 7 public page is the one exception — it's unauthenticated and Server-Component-only, so it calls `fetch` directly rather than going through this `apiFetch` convention.)
- Browser talks **directly** to the backend (`NEXT_PUBLIC_API_URL`) — no Next.js API-route proxy for these calls.
- `config/env.ts`: `serverEnv.backendInternalUrl` (Docker DNS, server-only) vs `publicEnv.apiUrl` (browser, `NEXT_PUBLIC_*`).

## UI

- Shared primitives: `components/ui/{Button,Input,Card,Spinner,EmptyState}`.
- `WorkspaceSwitcher` — top bar, lists workspaces (derives current one from `usePathname()`), logout button.
- `features/workspaces/permissions.ts` (incl. `canComment`/`canModerateComments`, Stage 6; `canManageBilling`, Stage 8), `features/documents/permissions.ts` — UI-only mirrors of the backend's `WorkspacePermissionsService`, used to hide/disable controls a role can't use. **Never authoritative** — backend re-checks everything.
- `features/documents/tree.ts` (`buildDocumentTree`) — the backend returns a flat, position-ordered-per-parent-group list; this rebuilds the nested shape `DocumentSidebar`/`DocumentTreeItem` render from, since the flat list isn't itself grouped by parent.
- `DocumentSidebar` derives the highlighted/active document id from `usePathname()` (regex on `/document/([^/]+)`) rather than a prop, so it works whether it's wrapping the plain workspace page or a document page.
- Sidebar reordering is simple up/down buttons (move before/after the adjacent sibling via the move endpoint's `referenceId`/`placement`), not drag-and-drop — see ADR-012.

## Testing

Vitest (`npm test` in `frontend/`). Pure-function tests only (`validation.test.ts`, `permissions.test.ts`, `api.test.ts`, `tree.test.ts`, `textDiff.test.ts`, `versionsApi.test.ts`, Stage 6's `comments/api.test.ts`, `notifications/api.test.ts`, `attachments/api.test.ts`, Stage 7's `publishing/sanitize.test.ts`, Stage 8's `search/api.test.ts`/`billing/api.test.ts`) — no component-rendering setup exists yet, so `DocumentSidebar`/`DocumentPage`/`CollaborativeEditor`/`VersionHistoryPanel`/`CommentsPanel`/`NotificationsBell`/`AttachmentsPanel`/`PublishControl`/`PublicDocumentView`/`SearchDialog`/`BillingSection` are covered by backend e2e behavior + live Docker verification + build, not frontend unit tests. No browser automation was available in this environment for Stage 8 either (same limitation noted since Stage 6/7) — verified instead via curl against the freshly rebuilt Docker stack (registration → workspace → document create → search → mock-pay, confirming exact response shapes match what the new frontend code consumes) plus `tsc --noEmit`/lint/build/vitest all passing.
