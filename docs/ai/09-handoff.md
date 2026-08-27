# Agent Handoff

## Current Stage

Stage 3 — Documents (not started)

## Read First

- `docs/ai/00-context.md`
- `docs/ai/01-architecture.md`
- `docs/ai/02-current-state.md`
- `docs/ai/04-database.md`
- `docs/ai/06-rules.md`
- this file

## Stable Existing Infrastructure

Auth, workspaces, RBAC, invitations, Docker, CI, logging/metrics/health — all implemented and tested (33 backend unit + 11 backend e2e + 16 frontend tests, all passing as of this handoff). Don't re-verify from scratch; trust `02-current-state.md`, spot-check only what you're about to touch.

## Current Objective

Implement the Stage 3 document foundation (see `07-roadmap.md` for full scope): `Document` entity, CRUD, nested tree (parent/child + ordering), workspace-level document authorization, frontend document tree/sidebar + a basic document page shell. **No editor, no Yjs.**

## Reuse (exact names)

- `WorkspacePermissionsService` (`backend/src/modules/workspaces/workspace-permissions.service.ts`) — extend `canCreateDocument`/`canEditDocument` (already stubbed) rather than writing new role checks.
- `WorkspaceMembershipGuard` + `@CurrentMembership()` — put new document routes under `/workspaces/:workspaceId/documents` and reuse this guard for the 404-vs-403 policy.
- `JwtAuthGuard` + `@CurrentUser()` (`backend/src/modules/auth/`).
- TypeORM migration workflow: `npm run migration:generate` in `backend/`, then hand-add FKs/indexes (the generator misses both — see ADR-002 in `08-decisions.md`).
- Frontend: `AuthProvider`/`useAuth()`/`apiFetch` pattern (`frontend/src/features/auth/`), `features/workspaces/api.ts` style (plain functions taking `apiFetch`), `components/ui/*` primitives, `WorkspaceShell.tsx` as the closest existing example of a role-gated workspace-scoped page.

## Do Not Touch

- Auth architecture (JWT strategy, refresh rotation, cookie config) unless a concrete Stage 3 requirement forces it.
- Docker/CI/logging/metrics foundation.
- `WorkspacePermissionsService`'s existing methods — add to it, don't restructure it.

## Do Not Start Yet

Yjs, CRDT, collaborative editor, comments, billing, search, public publishing (Stages 4+).

## Definition of next work

Add a `Document` domain (entity + migration + module) scoped to a workspace, with basic tree structure and CRUD guarded by the existing permission/membership layers, plus a minimal frontend tree view and document page — no rich editor, no realtime.
