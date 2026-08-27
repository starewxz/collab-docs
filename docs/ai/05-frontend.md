# Frontend

Next.js 16.3.3, App Router, React 19, TypeScript strict. **Server Components by default** — do not add blanket `'use client'` to layouts or page shells.

## Routes

| Route | Type | Notes |
|---|---|---|
| `/` | Server | Stage 1 connectivity check, not a real product page |
| `/login`, `/register` | Server page wrapping a Client form | `LoginForm`/`RegisterForm`, redirect to `?next=` after success |
| `/workspace` | Client (`WorkspaceDashboard`) | list workspaces, create workspace, pending invitations |
| `/workspace/[workspaceId]` | Client (`WorkspaceShell`) | members, invite, role change/remove, leave |
| `/invitations/[token]` | Client (`InvitationLinkPage`) | email-link accept/reject flow |

`(auth)` and `(workspace)` are route groups (no URL effect). `proxy.ts` (Next 16's renamed `middleware.ts`) gates `/workspace/:path*` — redirects to `/login?next=...` if no `refresh_token` cookie. **This is a UX shortcut, not security** — the backend independently authorizes every call.

## Why the dashboard/shell are Client Components

Next.js Server Components cannot set or rotate cookies, and the refresh token must rotate. Rather than fight that, authenticated data (workspaces, members, invitations) is fetched **client-side** after the page shell loads — "server shell + client data island". This is a deliberate Stage 2 decision (see `08-decisions.md`), not a default to imitate everywhere. Keep new Server Components server-rendered; only add `'use client'` where session data or interactivity is actually needed.

## Auth architecture

- `AuthProvider` (`features/auth/AuthProvider.tsx`, Client, wraps `{children}` in the root layout): holds `status` (`loading`/`authenticated`/`unauthenticated`), `user`, and an in-memory `accessToken` (`useRef`, never localStorage, lost on hard refresh).
- On mount: silently calls `POST /auth/refresh` (browser → backend directly, `credentials: 'include'`) to restore a session from the httpOnly cookie.
- `apiFetch<T>(path, options)`: attaches `Authorization: Bearer <token>`; on a 401, refreshes once and retries; if that also fails, flips to `unauthenticated`.
- `useRequireAuth()` — redirects to `/login` client-side if status becomes `unauthenticated` (fallback for proxy.ts's cookie-only check missing an expired/revoked session).

## API layer

- `lib/backend-fetch.ts` — unauthenticated calls (register/login/refresh/logout), `credentials: 'include'`, throws `ApiError` (status + body) on non-2xx.
- `features/auth/api.ts`, `features/workspaces/api.ts` — typed wrappers per endpoint. Workspace/invitation functions take `apiFetch` as a parameter (from `useAuth()`) rather than importing React — keeps them plain and unit-testable.
- Browser talks **directly** to the backend (`NEXT_PUBLIC_API_URL`) — no Next.js API-route proxy for these calls.
- `config/env.ts`: `serverEnv.backendInternalUrl` (Docker DNS, server-only) vs `publicEnv.apiUrl` (browser, `NEXT_PUBLIC_*`).

## UI

- Shared primitives: `components/ui/{Button,Input,Card,Spinner,EmptyState}`.
- `WorkspaceSwitcher` — top bar, lists workspaces (derives current one from `usePathname()`), logout button.
- `features/workspaces/permissions.ts` — UI-only mirror of the backend's `WorkspacePermissionsService`, used to hide/disable controls a role can't use. **Never authoritative** — backend re-checks everything.

## Testing

Vitest (`npm test` in `frontend/`). Pure-function tests only (`validation.test.ts`, `permissions.test.ts`, `api.test.ts`) — no component-rendering setup exists yet.
