# Collab Docs

A Notion-like collaborative document workspace. **Stages 1 (foundation/infrastructure) and 2 (auth, workspaces, RBAC, invitations) are complete.** Documents, real-time collaboration, comments, billing, search, and file upload are not implemented yet. See `docs/ai/` for the current, verified implementation state — this README is not kept in lockstep with every stage.

## Stack

- **Frontend**: Next.js (App Router) + TypeScript
- **Backend**: NestJS (modular monolith) + TypeScript, strict mode
- **Database**: PostgreSQL + TypeORM (migrations, no `synchronize`)
- **Cache / Queue backing store**: Redis
- **Job queue**: BullMQ
- **Object storage**: MinIO (S3-compatible)
- **Observability**: structured logging (pino), Prometheus metrics, correlation IDs, Terminus health checks
- **Infra**: Docker Compose

## Architecture

The backend is a **modular monolith**: one deployable NestJS app, organized into modules with clear boundaries, rather than microservices. This keeps Stage 1 simple while leaving room for future domains (`auth`, `users`, `workspaces`, `documents`, `collaboration`, `comments`, `notifications`, `billing`, `search`, `storage`, `analytics`) to be added as self-contained modules under `backend/src/modules` without restructuring anything that exists today. See `backend/src/modules/README.md` for the reserved boundaries.

Infrastructure concerns (database, redis, queue, storage, health, metrics, logging) are separated from business modules from day one, so business modules can depend on them without ever reaching into `node_modules` clients directly.

## Repository structure

```
collab-docs/
├── frontend/                Next.js App Router app
│   └── src/
│       ├── app/              routes, layouts, loading/error boundaries
│       ├── components/ui/    Button, Input, Card, Spinner, EmptyState
│       ├── features/         feature modules (empty until Stage 2+)
│       ├── lib/               server-side helpers (e.g. backend fetch)
│       ├── config/            env config (server vs public)
│       └── types/
├── backend/                 NestJS app
│   └── src/
│       ├── common/            filters, guards, interceptors, decorators,
│       │                      logging, metrics — cross-cutting infra
│       ├── config/             typed env config + validation
│       ├── database/           TypeORM data source, module, migrations
│       ├── redis/               shared Redis client
│       ├── queue/               BullMQ connection + queue name registry
│       ├── storage/             MinIO client
│       ├── health/              Terminus health checks
│       └── modules/            business modules (empty — see README there)
├── docker-compose.yml
├── .env.example
└── .github/workflows/ci.yml
```

## Server vs Client Components (Next.js)

This project is evaluated on getting this boundary right, so the rule is explicit:

- **Server Components by default.** Layouts, pages, and anything that only renders data or static content stays a Server Component. No blanket `'use client'` at the top of large trees.
- **Client Components only where the browser is required**: forms with interactive state, the future Yjs editor, drag & drop, presence indicators, dialogs, interactive comments, or any component using hooks/browser APIs. Mark only the smallest component that needs it, not its parent tree.
- Route groups `(auth)` and `(workspace)` are reserved for Stage 2+ pages (see the `README.md` in each). Routes outside a group (like the homepage) are public by default.

## Frontend/backend URL split

- `BACKEND_INTERNAL_URL` — server-only, used by Server Components/Route Handlers to call the backend over the Docker network (`http://backend:4000`). Never exposed to the browser.
- `NEXT_PUBLIC_API_URL` — inlined into the browser bundle at **build time** (not runtime). Only ever put non-secret, publicly-reachable URLs here.

The homepage is a Server Component that calls `getBackendStatus()` (`frontend/src/lib/backend.ts`), which hits the backend's `/api/health/live` server-side — this is the proof that the two containers can talk to each other, not a permanent UI feature.

## Getting started (Docker)

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps   # all 5 services should show (healthy)
```

Then:

- Frontend: http://localhost:3001 (default `FRONTEND_HOST_PORT`; see below)
- Backend health: http://localhost:4000/api/health
- Swagger docs: http://localhost:4000/api/docs
- Metrics: http://localhost:4000/api/metrics
- MinIO console: http://localhost:9001

### Port conflicts

Default **container-internal** ports never change (services always reach each other as `postgres:5432`, `redis:6379`, `minio:9000`). If a **host** port is already taken on your machine, override it in `.env` — see the commented `*_HOST_PORT` block in `.env.example`. If you change `FRONTEND_HOST_PORT`, also update `FRONTEND_URL` so CORS keeps working.

## Local development (without Docker)

Run infra only, then the apps natively:

```bash
docker compose up -d postgres redis minio
```

Backend (`backend/.env`, or exported vars) needs `POSTGRES_HOST`, `REDIS_HOST`, and `MINIO_ENDPOINT` set to `localhost` (and matching whatever host ports you published) instead of the Docker service names:

```bash
cd backend
npm install
npm run migration:run
npm run start:dev
```

Frontend:

```bash
cd frontend
npm install
BACKEND_INTERNAL_URL=http://localhost:4000 npm run dev
```

## Environment variables

See `.env.example` for the full list, grouped by category (application, Postgres, Redis, MinIO, JWT placeholders for Stage 2, frontend). Validated at startup via Joi (`backend/src/config/env.validation.ts`) — the app refuses to start with missing/invalid config rather than falling back to silent defaults for anything security- or connectivity-relevant.

## Migrations

TypeORM migrations live in `backend/src/database/migrations`. `synchronize` is always `false`.

```bash
cd backend
npm run migration:generate   # after changing/adding an entity
npm run migration:run
npm run migration:revert
```

`migration:run:prod` runs against the compiled `dist/` output (no ts-node), for use in deployment where only production dependencies are installed.

## Health, metrics, logging

- `GET /api/health` — per-dependency status (Postgres, Redis, MinIO) via Terminus. Returns `503` if any dependency is down, with per-service detail preserved.
- `GET /api/health/live` — lightweight liveness probe, no dependency checks.
- `GET /api/metrics` — Prometheus exposition format (`http_requests_total`, `http_request_duration_seconds`, plus default Node process metrics). Additional metrics (`collab_connections_current`, `crdt_updates_total`, `queue_jobs_processed_total`, `billing_webhooks_total`) are added by the modules that produce those events in later stages.
- Structured JSON logs (pino) include `correlationId`, `method`, `path`, `statusCode`, `duration` per request. Headers/bodies are never serialized into logs, so secrets can't leak in even by accident.
- Correlation IDs: send `x-correlation-id` to propagate your own, otherwise one is generated. It's echoed in the response header, present in every log line for that request, and included in every error response body.

## API docs

Swagger UI: `GET /api/docs`. All routes are served under the `/api` prefix.

## Testing

Backend:

```bash
cd backend
npm test        # unit tests, no infra required
npm run test:e2e   # boots the real app - requires Postgres/Redis/MinIO running
```

Frontend:

```bash
cd frontend
npm test         # vitest, unit-level only
```

## CI

`.github/workflows/ci.yml` runs on every push/PR: backend (`lint` → `build` → unit tests → e2e tests against Postgres/Redis/MinIO) and frontend (`lint` → unit tests → `build`, which also type-checks).

## What's not here yet

Auth, users, workspaces, RBAC, and invitations are implemented (Stage 2). Not yet implemented: documents/document CRUD, Yjs/CRDT collaboration, comments, billing, search indexing, and file upload endpoints. See `docs/ai/02-current-state.md` for the verified, detailed breakdown and `docs/ai/07-roadmap.md` for what's next.
