# Roadmap

## Stage 1 — Foundation — DONE
Next.js + NestJS scaffolding, Postgres/TypeORM, Redis, BullMQ connection, MinIO client, Docker Compose, health/metrics/logging/correlation IDs, Swagger, CI.

## Stage 2 — Auth + Workspaces + RBAC + Invitations — DONE
Register/login/refresh-rotation/logout/me, Workspace + WorkspaceMember + WorkspaceInvitation, `WorkspacePermissionsService`, member management, invitation accept/reject (token + by-id), frontend auth + dashboard + workspace shell. See `02-current-state.md` for the full checklist.

## Stage 3 — Document Foundation — NEXT (not started)

Scope:
- `Document` entity (workspace-scoped), migration with FKs/indexes
- Document CRUD (create/read/update/archive or delete — pick one deletion policy and document it in `08-decisions.md`)
- Nested tree: parent/child relationship, ordering/position, move/reorder
- Workspace-level document authorization via **existing** `WorkspacePermissionsService.canCreateDocument`/`canEditDocument` (already stubbed, VIEWER read-only) — extend, don't replace
- Document-level permission overrides only if a concrete requirement demands it; don't build this speculatively
- Frontend: document tree/sidebar, a basic document page/shell (no editor yet)

**Do not start Yjs/CRDT collaboration in Stage 3** unless document structure genuinely cannot be separated from it.

## Stage 4 — Realtime Collaboration
Yjs / CRDT, presence, live cursors.

## Stage 5 — Persistence & History
Document snapshots, version history, restore.

## Stage 6 — Social
Comments, mentions, notifications, attachments.

## Stage 7 — Public & SEO
Public sharing, SSR/ISR for public pages, SEO metadata.

## Stage 8 — Growth
Search, billing, plan limits.

## Stage 9 — Frontend Polish
UX completion pass across all prior stages.

## Stage 10 — Hardening
Testing, security, observability, final audit.
