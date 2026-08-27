# Project Context

**Collab Docs** — a Notion-like collaborative document workspace (multi-tenant: users belong to workspaces with roles).

## Stack

- Frontend: Next.js 16 (App Router) + TypeScript, React 19
- Backend: NestJS 11 (modular monolith) + TypeScript strict
- DB: PostgreSQL 16 + TypeORM (migrations only, `synchronize: false`)
- Cache/queue backing store: Redis (BullMQ not yet used by any real feature)
- Object storage: MinIO (not yet used by any real feature)
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

- **Completed: Stage 1** (foundation/infra) **and Stage 2** (auth + workspaces + RBAC + invitations).
- **Next: Stage 3** (documents foundation — not started, no Document entity/module exists yet).

## Facts every agent must know

1. Roles (`OWNER > ADMIN > EDITOR > VIEWER`) are **resolved from the DB on every request** — never trusted from JWT claims.
2. `WorkspacePermissionsService` is the single source of truth for authorization rules. Never inline `role === 'ADMIN'` checks.
3. `WorkspaceMembershipGuard` returns **404** for non-members (not 403), to avoid confirming a workspace exists.
4. Access token: short-lived JWT, returned in the response body only, kept in-memory on the frontend (never localStorage). Refresh token: opaque random value, httpOnly cookie, hashed at rest, rotates on every use with reuse detection.
5. No `Document` entity/module exists yet — Stage 3 has not started.
6. Migrations are authoritative; `synchronize` is always `false`.
7. Don't rewrite Stage 1/2 infra without a concrete reason — see `06-rules.md`.
8. Full endpoint/entity/route detail lives in `03-api.md`, `04-database.md`, `05-frontend.md` — not repeated here.
