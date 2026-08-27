# Architectural Decisions

## ADR-001 — NestJS modular monolith
**Decision:** One deployable backend, business domains as modules under `src/modules/*`, not microservices.
**Reason:** Simpler ops/deploy for this project's scale; module boundaries give a migration path later if ever needed.
**Impact:** New domains (documents, comments, ...) are added as new modules, not new services.

## ADR-002 — PostgreSQL + TypeORM, `synchronize: false`
**Decision:** Migrations are the only way schema changes ship.
**Reason:** Predictable, reviewable schema history; `synchronize: true` is unsafe outside prototyping.
**Impact:** Every entity change needs a migration (`npm run migration:generate`, then hand-check FKs/partial indexes — TypeORM's generator misses both).

## ADR-003 — Access token in memory, refresh token in httpOnly cookie
**Decision:** Access JWT returned in the response body and held in a React ref only (never persisted). Refresh token is an httpOnly, `sameSite=lax` cookie, hashed at rest.
**Reason:** Avoids XSS-exposed tokens in localStorage; matches the "preferred browser architecture" requirement from the Stage 2 spec.
**Impact:** Full page reload loses the access token — `AuthProvider` silently re-fetches it via `/auth/refresh` on mount. See ADR-005 for why this can't happen in a Server Component.

## ADR-004 — Refresh token path is `/` (not `/api/auth`)
**Decision:** Broadened from an initial `/api/auth` scoping.
**Reason:** The frontend's `proxy.ts` runs on a different port/origin and needs to see the cookie on normal page navigations to gate `/workspace/*`; a path-scoped cookie was invisible to it.
**Impact:** Slightly larger cookie exposure surface (still httpOnly + sameSite). `COOKIE_DOMAIN` env var exists for cross-subdomain production deployments.

## ADR-005 — Server shell + client data island for authenticated pages
**Decision:** `/workspace` and `/workspace/[id]` are Client Components that fetch data after mount, rather than Server Components fetching with forwarded cookies.
**Reason:** Refresh-token rotation requires setting a cookie, which Next.js Server Components cannot do. Doing the rotation in a Server Component would desync the browser's cookie from the DB session on every render.
**Impact:** No true SSR for authenticated workspace data. Acceptable per Stage 2 scope; revisit only if SSR becomes a real requirement.

## ADR-006 — Workspace role resolved from DB, never trusted from JWT
**Decision:** JWT payload is `{sub, email}` only.
**Reason:** Roles can change after a token is issued; embedding them would mean stale permissions until the token expires (15 min window of incorrect access).
**Impact:** Every authorized request does a `WorkspaceMember` lookup (`WorkspaceMembershipGuard`). Verified live: promoting a user mid-session changes their effective permissions on the very next request, same token.

## ADR-007 — Immutable OWNER in Stage 2
**Decision:** OWNER cannot be removed, demoted, or leave; no ownership transfer endpoint exists.
**Reason:** Scoped out of Stage 2 to avoid an underspecified edge case (what happens to a workspace with zero owners).
**Impact:** Deliberate limitation — add ownership transfer as its own feature when needed, don't work around it ad hoc.

## ADR-008 — Invitation tokens hashed at rest; two accept/reject paths
**Decision:** Only `SHA-256(token)` is stored. Accept/reject support both `/invitations/:token/...` (email-link flow) and `/invitations/by-id/:id/...` (in-app flow, authorized by email match instead of the token).
**Reason:** A one-way hash means the raw token can never be shown again after creation — but the in-app "My Invitations" list (`GET /invitations/me`) still needs a way to act on invitations it can see.
**Impact:** Any future invitation UI should default to the `by-id` path unless it specifically has the raw token from a link.

## ADR-009 — 404-for-non-member, 403-for-insufficient-role
**Decision:** `WorkspaceMembershipGuard` throws 404 if the caller isn't a member; permission checks past that point throw 403.
**Reason:** Avoids confirming a workspace's existence to outsiders (existence disclosure), while still giving members clear feedback when they lack a specific permission.
**Impact:** Any new workspace-scoped endpoint should reuse `WorkspaceMembershipGuard` rather than inventing its own not-found handling.

## ADR-010 — Central `WorkspacePermissionsService`
**Decision:** All role-based rules live in one injectable service with explicit methods (not a generic capability-string dispatcher, not CASL/OPA).
**Reason:** Simple and explicit was preferred over a generic policy engine for this project's current complexity.
**Impact:** Stage 3+ document permissions should add methods here (`canCreateDocument`/`canEditDocument` are already stubbed) rather than creating a parallel permission system.
