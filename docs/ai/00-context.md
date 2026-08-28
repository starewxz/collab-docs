# Project Context

**Collab Docs** — a Notion-like collaborative document workspace (multi-tenant: users belong to workspaces with roles).

## Stack

- Frontend: Next.js 16 (App Router) + TypeScript, React 19
- Backend: NestJS 11 (modular monolith) + TypeScript strict
- DB: PostgreSQL 16 + TypeORM (migrations only, `synchronize: false`)
- Cache/queue backing store: Redis + BullMQ (notification delivery)
- Object storage: MinIO (private presigned attachment upload/download)
- Observability: pino structured logs, Prometheus metrics, correlation IDs, Terminus health
- Infra: Docker Compose (5 services: postgres, redis, minio, backend, frontend)

## Architecture style

- Backend: one deployable NestJS app, business domains under `backend/src/modules/*`, cross-cutting infra under `common/`, `config/`, `database/`, `redis/`, `queue/`, `storage/`.
- Frontend: Server Components by default; Client Components only for interactivity (forms, auth session, dashboards that need live data).

## Local URLs (docker compose)

- Frontend: http://localhost:3001
- Backend API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs
- Health: http://localhost:4000/api/health
- Metrics: http://localhost:4000/api/metrics
- MinIO console: http://localhost:9001

## Stage status

- **Completed:** Stages 1–10, including growth, frontend completion, and the final testing/security/observability/submission audit.
- **Current:** FINAL — Submission Ready. No later stage is defined.

## Facts every agent must know

1. Roles (`OWNER > ADMIN > EDITOR > VIEWER`) are **resolved from the DB on every request** — never trusted from JWT claims.
2. `WorkspacePermissionsService` is the single source of truth for authorization rules. Never inline `role === 'ADMIN'` checks.
3. `WorkspaceMembershipGuard` returns **404** for non-members (not 403), to avoid confirming a workspace exists.
4. Access token: short-lived JWT, returned in the response body only, kept in-memory on the frontend (never localStorage). Refresh token: opaque random value, httpOnly cookie, hashed at rest, rotates on every use with reuse detection.
5. `Document` entity/module exists (`backend/src/modules/documents/`) — CRUD, tree/parentId hierarchy, fractional-position ordering, whole-subtree archive/restore.
6. `CollaborationGateway`/`CollaborationService` (`backend/src/modules/collaboration/`) provide live Yjs sync + presence over a `/collab` socket.io namespace, authorized the same way as REST (JWT + membership + `canEditDocument`).
7. Collaborative state is durable since Stage 5: `CollaborationPersistenceService` upserts one `document_versions` row (`kind='auto'`) per document on a throttled interval; `VersionsService` provides explicit history (`manual`/`restore-point` rows) with list/inspect/create/restore. Verified surviving a real Docker container restart. See ADR-013/014.
8. Migrations are authoritative; `synchronize` is always `false`.
9. Don't rewrite Stage 1/2/3/4/5 infra without a concrete reason — see `06-rules.md`.
10. Full endpoint/entity/route detail lives in `03-api.md`, `04-database.md`, `05-frontend.md` — not repeated here.
