# Current State

**Last completed stage:** Stage 2 (Auth + Workspaces + RBAC + Invitations)
**Current stage:** Stage 3 (Documents) — **not started**

## Implemented

### Infrastructure (Stage 1)
- [x] Next.js App Router + NestJS modular monolith
- [x] PostgreSQL + TypeORM, migrations only (2 migrations: pgcrypto extension, core schema)
- [x] Redis client (`RedisModule`), BullMQ connection (`QueueModule`, no processors)
- [x] MinIO client (`StorageModule`), bucket-ensure on boot, no upload endpoints
- [x] Docker Compose, all 5 services healthchecked
- [x] Health (`/api/health`, `/api/health/live`), Prometheus metrics (`/api/metrics`), pino logging, `x-correlation-id`
- [x] Swagger (`/api/docs`), CI (GitHub Actions: backend lint/build/unit/e2e with real Postgres, frontend lint/test/build)

### Authentication (Stage 2)
- [x] Register / Login (argon2id password hashing)
- [x] Access JWT (15 min, `{sub, email}` payload only), returned in body
- [x] Refresh token: opaque random, HMAC-hashed at rest, httpOnly cookie (`refresh_token`, path `/`)
- [x] Refresh rotation + reuse detection (reuse revokes all sessions for that user)
- [x] Logout (revokes session, clears cookie)
- [x] `GET /api/auth/me`
- [x] Login rate-limited (5/60s), register rate-limited (20/60s) — separate buckets, verified not to leak onto other routes

### Workspaces
- [x] Create workspace (transactional: workspace + OWNER membership together)
- [x] List my workspaces, get one workspace (404 for non-members)
- [x] Unique slug generation with collision retry

### RBAC
- [x] `OWNER > ADMIN > EDITOR > VIEWER`, enforced via `WorkspacePermissionsService`
- [x] Owner immutable: cannot be removed, demoted, or leave (Stage 2 policy — no ownership transfer yet)
- [x] Member list, role change (`PATCH .../members/:id`), remove (`DELETE .../members/:id`), self-leave (`DELETE .../members/me`)

### Invitations
- [x] Create (OWNER/ADMIN only, role restricted to ADMIN/EDITOR/VIEWER)
- [x] Token hashed at rest (SHA-256); raw token/URL only returned in the API response when `NODE_ENV !== production`
- [x] List for workspace (OWNER/ADMIN), list for current user's email (`/invitations/me`)
- [x] Accept/reject by token (`/invitations/:token/...`, email-link flow) **and** by id (`/invitations/by-id/:id/...`, in-app flow used by the dashboard since the raw token can't be recovered after hashing)
- [x] Concurrency-safe accept (row lock + transaction), partial unique DB index prevents duplicate active invites

### Frontend
- [x] `AuthProvider` (Client) — silent session bootstrap via refresh on mount, in-memory access token, `apiFetch` with 401-retry-once-via-refresh
- [x] `/login`, `/register` (Client forms, basic validation)
- [x] `/workspace` dashboard (list workspaces, create workspace, pending invitations with accept/reject)
- [x] `/workspace/[workspaceId]` shell (members list, role change/remove, invite form — all role-gated in the UI; backend re-enforces)
- [x] `/invitations/[token]` standalone accept/reject page (email-link flow)
- [x] `WorkspaceSwitcher` (top bar, links between workspaces)
- [x] `proxy.ts` redirect-if-no-cookie for `/workspace/*`

### Testing (verified by running, not assumed)
- [x] Backend unit tests: **33 passing** (`npm test`) — permission matrix, password verification, refresh rotation/reuse, invitation expiration/email-matching
- [x] Backend e2e tests: **11 passing** (`npm run test:e2e`, real Postgres) — full auth lifecycle, workspace/invitation flow, VIEWER security, tenant isolation (404s), owner protection, rate-limit isolation, concurrent-accept race
- [x] Frontend tests: **16 passing** (`npm test`, vitest) — email/password validation, permission-matrix UI gating, invitation API call shapes

## Not Implemented

- Document entity/module, document CRUD, document tree — **Stage 3, not started**
- Yjs / CRDT / realtime collaboration
- Comments, notifications, mentions, attachments
- Billing, plan limits
- Search
- Public sharing / SSR-ISR for public content
- File upload endpoints (MinIO client exists, no controller uses it)
- BullMQ processors (queue names reserved in `QueueName` enum, nothing enqueues yet)
- Ownership transfer
- Frontend component tests (only pure-function tests exist; no React Testing Library setup)
- Real email delivery (invitations only work via dev-mode token exposure or in-app by-id accept)
