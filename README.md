# Collab Docs

Collab Docs is a submission-ready, Notion-like collaborative document workspace. Teams organize nested documents, edit together with Yjs, discuss work in comment threads, manage files and versions, search durable content, publish safe public pages, and enforce workspace roles and plan limits.

## Architecture

- **Frontend:** Next.js 16 App Router, React 19, and TypeScript. Pages and layouts remain Server Components by default; interactive auth, workspace, editor, dialog, and panel surfaces are narrowly scoped Client Components.
- **Backend:** NestJS 11 modular monolith with controller → service → TypeORM repository boundaries.
- **Data:** PostgreSQL 16 with migrations only (`synchronize: false`), Redis/BullMQ for notifications, and private MinIO object storage for attachments.
- **Operations:** Docker Compose, pino JSON logs with correlation IDs, Terminus health checks, Prometheus metrics, Swagger, and GitHub Actions CI.

Authenticated browser calls go directly to the API. Access JWTs live only in memory; rotating opaque refresh tokens use an httpOnly cookie and are stored only as hashes. Roles are loaded from PostgreSQL on each request. `WorkspacePermissionsService` handles OWNER/ADMIN/EDITOR/VIEWER authorization, while `EntitlementsService` independently handles plan limits.

## Collaboration and persistence

Each active document has an in-memory Yjs `Y.Doc` and awareness state behind the `/collab` Socket.IO namespace. Concurrent client updates are merged as CRDT operations and relayed to peers; VIEWER and outsider writes are rejected server-side.

Full Yjs state is persisted to a throttled `document_versions` durability row and hydrated when a session is recreated. Manual snapshots and restore points share that persisted representation. Restore first preserves the current state, replaces document content in a Yjs transaction, and broadcasts the resulting update so active clients converge without reloading.

## Public pages, search, storage, and billing

- `/p/[slug]` is a Server Component with ISR, metadata, canonical/OG tags, and on-demand revalidation for publication-state changes. It reads only persisted public content. React text escaping plus URL-scheme allowlisting prevents stored XSS, and public responses omit private workspace data.
- Search uses a PostgreSQL generated `tsvector` with a GIN index over title and durable document text. Queries are parameterized, workspace-scoped, permission-aware, and exclude archived documents.
- Attachments use short-lived presigned MinIO PUT/GET URLs. Metadata is tenant-scoped; MIME and declared size are validated before upload, actual object size is verified on confirmation, and the bucket is not public.
- Every workspace has a FREE or PRO subscription. A replaceable mock payment provider feeds the same idempotent webhook core used by the webhook endpoint. Unique event IDs prevent repeated effects; backend document, member, feature, and storage limits cannot be bypassed through direct API calls. Downgrades never delete existing data.

## Run with Docker

```bash
cp .env.example .env
# Fill JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, REVALIDATE_SECRET,
# and BILLING_WEBHOOK_SECRET with strong random values.
docker compose up -d --build
docker compose ps
```

The backend container runs all pending TypeORM migrations before starting the API. All five services should report healthy.

- App: <http://localhost:3001>
- API and Swagger: <http://localhost:4000/api> · <http://localhost:4000/api/docs>
- Health: <http://localhost:4000/api/health> and `/api/health/live`
- Metrics: <http://localhost:4000/api/metrics>
- MinIO console: <http://localhost:9001>

Host ports are configurable through the `*_HOST_PORT` variables documented in `.env.example`. `NEXT_PUBLIC_API_URL` is public and build-time only; never place secrets in a `NEXT_PUBLIC_*` variable. `BACKEND_INTERNAL_URL` and `FRONTEND_INTERNAL_URL` are container-network addresses used for server-side fetches and revalidation.

## Environments

`NODE_ENV` selects one of four profiles (`backend/src/config/env.validation.ts`). There is one canonical env template (`.env.example`) plus a small staging overlay (`.env.staging.example`) — the goal is one source of truth per value, not a parallel copy of every variable per environment.

| Environment | `NODE_ENV` | Template | Notes |
|---|---|---|---|
| Development | `development` (default) | `.env.example` | `docker compose up` or `npm run start:dev`/`npm run dev` locally. Pretty-printed debug logs, real error messages in API responses, and invitation responses include the raw dev token/URL (no email delivery exists yet — see [Known limitations](#known-limitations)) so you can accept an invite without a mailbox. |
| Test | `test` | `backend/test/.env.test` (already checked in; used automatically by `npm run test:e2e`) | Same relaxed behavior as development, plus a short `COLLAB_PERSIST_INTERVAL_MS` so persistence/search-indexing tests don't wait out the real 3s throttle. |
| Staging | `staging` | `.env.example` + `.env.staging.example` | A real, network-reachable deployment for pre-production verification — treated as **production-like** for every security-sensitive check: secure (`Secure`) refresh cookies, hidden internal error detail, structured JSON logs, and **no** dev-token exposure in invitation responses (see `AppConfigService.isProductionLike`, the single place this distinction is made). Use its own database/Redis/MinIO and its own secrets — never copy production secrets into staging. |
| Production | `production` | `.env.example` (all values supplied for real, none left as placeholders) | Same production-like security posture as staging. `COOKIE_DOMAIN` must be set if the frontend/backend are on different subdomains; all `*_SECRET` values must be freshly generated (`openssl rand -hex 32`), never reused across environments. |

`.env.staging.example` only lists the values that differ from `.env.example` (`NODE_ENV=staging` plus the URL/domain placeholders you'd point at a real staging host) — copy `.env.example` first, then apply the staging overlay on top, rather than maintaining two full copies of every variable.

## Local development

Start PostgreSQL, Redis, and MinIO, then run migrations and the applications:

```bash
cd backend
npm ci
npm run migration:run
npm run start:dev
```

```bash
cd frontend
npm ci
BACKEND_INTERNAL_URL=http://localhost:4000 npm run dev
```

When infrastructure is published on non-default host ports, override the corresponding backend environment values (the repository Compose defaults are PostgreSQL `5434` and Redis `6380`).

## Tests and CI

```bash
cd backend
npm run lint
npm run build
npm test
npm run test:e2e

cd ../frontend
npm run lint
npm test
npm run build
```

The frontend build performs the TypeScript check. `.github/workflows/ci.yml` runs backend lint/build/unit/e2e against PostgreSQL, Redis, and MinIO, and frontend lint/tests/build on pushes to `main` and pull requests. CI configuration can be inspected locally, but a successful GitHub-hosted runner is only established by an actual Actions run.

## Observability

`GET /api/health` reports PostgreSQL, Redis, and MinIO separately; `/api/health/live` is the lightweight process probe. Structured request logs include an accepted or generated `x-correlation-id`, and error responses return it for support correlation. Prometheus metrics cover HTTP latency/counts, authentication, documents, collaboration sessions and persistence, queues/notifications, attachments, publishing/revalidation, search, plan-limit rejections, and billing/webhook failures.

## Known limitations

- Billing uses the intentional mock provider boundary rather than live Stripe.
- Notifications and invitations are in-app/dev-token flows; there is no real email or push provider.
- Comments are document-level with root + reply threading, not Yjs text-range anchors.
- Document ordering uses explicit up/down controls and fractional positions rather than drag-and-drop or position rebalancing.
- Yjs bootstrap sends full state on join and persistence stores a full-state buffer rather than an append-only update log; this favors correctness and simplicity over very-large-document bandwidth/write optimization.
- Editor image blocks reference external URLs; MinIO attachments are managed separately and are not embedded in published content.
