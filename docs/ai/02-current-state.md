# Current State

**Last completed stage:** Stage 7 (Public Sharing, SSR/ISR & SEO)
**Current stage:** none in progress — ready for Stage 8

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

### Documents (Stage 3)
- [x] `Document` entity (workspace-scoped, self-referencing `parentId`, `position` double precision, `archivedAt` soft-delete)
- [x] CRUD: create (root or child), list (flat, `includeArchived` query param), get, rename (`PATCH`)
- [x] Move/reorder via `POST .../move` — `parentId` (null = root) + optional `referenceId`/`placement` (`before`/`after`) for midpoint-bisection sibling reordering
- [x] Tree invariants enforced server-side: self-parent rejected, cycle rejected (walks up the candidate parent's ancestor chain), cross-workspace parent rejected (same scoped-lookup that also gives IDOR protection)
- [x] Archive/restore act on the **entire subtree** (BFS-collected), not just the target node — see ADR-011
- [x] Restoring a node whose parent is still archived (or gone) reparents it to workspace root instead of leaving it orphaned/invisible
- [x] Authorization reuses `WorkspacePermissionsService.canCreateDocument`/`canEditDocument` (VIEWER read-only, everyone else can mutate) and `WorkspaceMembershipGuard` (404-for-non-member policy) — no new permission system
- [x] IDOR protection: every lookup is scoped by `(id, workspaceId)` together (`getScopedWithManager`), never `findOne(id)` alone

### Realtime Collaboration (Stage 4)
- [x] `CollaborationGateway` (`backend/src/modules/collaboration/`) — socket.io gateway on the `/collab` namespace, one Yjs `Y.Doc` + `Awareness` per active document, held in-memory only (`CollaborationService`) - not persisted to Postgres, see ADR-013
- [x] Connection authorization pipeline before any document data is sent: JWT verified at handshake, then on `join` — workspace membership, document existence (workspace-scoped), and `canEditDocument` role check; a document is never trusted from the client without all three
- [x] Archived documents are read-only for every role via collaboration, matching the existing REST archive policy
- [x] CRDT sync: client sends `sync-update` (a Yjs update), server applies it (rejecting if `!canEdit`) and relays the identical bytes to the rest of the room - no "save whole document" endpoint, no `PATCH content`
- [x] Presence via `y-protocols/awareness`: `awareness-update` messages relayed through the same per-document `Awareness` instance; join/leave/cursor changes broadcast to the room; disconnect cleanup removes exactly that socket's awareness states
- [x] Reconnect/resync: client keeps its local `Y.Doc`/`Awareness` across a dropped socket; on reconnect it re-emits `join` and receives a fresh full-state `sync-update` - safe because Yjs update application is idempotent, so no history-tracking handshake is needed
- [x] Block content model (frontend, CRDT-backed): `Y.Array<Y.Map>` of blocks - paragraph, heading, bulletListItem, checkbox, codeBlock, image (metadata only, no upload) - each text-bearing block owns its own `Y.Text`
- [x] `CollaborativeEditor`/`BlockView`/`PresenceBar` (`frontend/src/features/collaboration/`) wired into `DocumentPage`, replacing the Stage 3 placeholder
- [x] Metrics: `collab_connections_current`, `collab_sessions_current` (gauges), `crdt_updates_total`, `collab_connection_errors_total{reason}` (counters, no per-document/user labels)

### Persistence & Version History (Stage 5)
- [x] `document_versions` table (`backend/src/modules/collaboration/entities/document-version.entity.ts`) — binary (`bytea`) full Yjs state snapshots, never JSON/plain text; `kind` discriminates `auto` (durability buffer)/`manual`/`restore-point` (history)
- [x] `CollaborationPersistenceService` — exactly one upserted `AUTO` row per document (partial unique index `(documentId) WHERE kind='auto'`), written via a trailing-throttled `scheduleFlush` (default 3s, `COLLAB_PERSIST_INTERVAL_MS` override) so continuous edits don't write a full snapshot per keystroke; safe against duplicate writes because Yjs update application is idempotent
- [x] Session hydration: `CollaborationGateway` loads the durable buffer into a brand-new in-memory session the first time a document is joined in a process (not on every join) - verified surviving an actual Docker container restart, not just an in-memory eviction
- [x] Conservative session eviction: `CollaborationService.scheduleEviction` (30s grace period, `COLLAB_EVICTION_GRACE_MS` override) flushes final state then drops the in-memory session only after zero connections for the whole grace period; a rejoin within the window cancels eviction and reuses the live session
- [x] Version history: list/inspect/create/restore (`workspaces/:workspaceId/documents/:documentId/versions...`), reusing `WorkspaceMembershipGuard`/`WorkspacePermissionsService.canEditDocument` - no second auth system
- [x] Restore semantics: current state is captured as a new `RESTORE_POINT` version **before** being overwritten (history is never destroyed); target content is applied via `replaceBlocksContent` (delete-all + reconstruct-and-insert inside one Yjs transaction, not a raw CRDT merge, since merges can only add operations, never remove them) and the resulting diff is broadcast live to the room, so already-connected clients converge without reloading
- [x] `VersionHistoryPanel` (frontend) — list/inspect/create/restore UI wired into `CollaborativeEditor`'s toolbar, with loading/empty/error states and an explicit restore confirmation step
- [x] Metrics: `collab_persist_total{result}`, `collab_versions_created_total{kind}`, `collab_version_restore_total{result}`, `collab_session_hydrated_total`, `collab_session_evicted_total`

### Realtime Collaboration (Stage 4)
- [x] `CollaborationGateway` (`backend/src/modules/collaboration/`) — socket.io gateway on the `/collab` namespace, one Yjs `Y.Doc` + `Awareness` per active document, held in-memory only (`CollaborationService`), backed by durable storage since Stage 5 (see above)
- [x] Connection authorization pipeline before any document data is sent: JWT verified at handshake, then on `join` — workspace membership, document existence (workspace-scoped), and `canEditDocument` role check; a document is never trusted from the client without all three
- [x] Archived documents are read-only for every role via collaboration, matching the existing REST archive policy
- [x] CRDT sync: client sends `sync-update` (a Yjs update), server applies it (rejecting if `!canEdit`) and relays the identical bytes to the rest of the room - no "save whole document" endpoint, no `PATCH content`
- [x] Presence via `y-protocols/awareness`: `awareness-update` messages relayed through the same per-document `Awareness` instance; join/leave/cursor changes broadcast to the room; disconnect cleanup removes exactly that socket's awareness states
- [x] Reconnect/resync: client keeps its local `Y.Doc`/`Awareness` across a dropped socket; on reconnect it re-emits `join` and receives a fresh full-state `sync-update` - safe because Yjs update application is idempotent, so no history-tracking handshake is needed
- [x] Block content model (frontend, CRDT-backed): `Y.Array<Y.Map>` of blocks - paragraph, heading, bulletListItem, checkbox, codeBlock, image (metadata only, no upload) - each text-bearing block owns its own `Y.Text`
- [x] `CollaborativeEditor`/`BlockView`/`PresenceBar` (`frontend/src/features/collaboration/`) wired into `DocumentPage`, replacing the Stage 3 placeholder
- [x] Metrics: `collab_connections_current`, `collab_sessions_current` (gauges), `crdt_updates_total`, `collab_connection_errors_total{reason}` (counters, no per-document/user labels)

### Comments, Mentions, Notifications & Attachments (Stage 6)
- [x] `Comment` entity (`backend/src/modules/comments/`) — document-scoped, two-level nesting only (root + flat replies, enforced in service logic not a DB constraint), soft-delete (`deletedAt`), `resolvedAt`/`resolvedById` for thread state, `editedAt` marker
- [x] CRUD + reply + resolve/reopen (`workspaces/:workspaceId/documents/:documentId/comments...`) — edit is author-only always; delete allows OWNER/ADMIN to moderate others' comments (`canModerateComments`); VIEWER is read-only (`canComment`/`assertCanComment` on `WorkspacePermissionsService`); archived documents block create/update/resolve/reopen but not delete (deliberate asymmetry — administrative cleanup stays possible)
- [x] `CommentMention` entity — `@user` mentions validated server-side against workspace membership (no cross-workspace mentions, 400 if invalid); duplicate mentions in one submission de-duped before insert (`Set` + unique composite index as DB-level backstop); editing a comment diffs old vs new mention sets and only notifies newly-added ones
- [x] `Notification` entity + `NotificationsService`/`NotificationsProcessor` — persistent in-app notifications for `mention`/`reply`/`thread_resolved`/`thread_reopened`, delivered async via a real BullMQ queue (`QueueName.NOTIFICATIONS`); idempotent by construction (`dedupeKey` unique column + `INSERT ... ON CONFLICT DO NOTHING`, with `jobId: dedupeKey` as a secondary BullMQ-level guard) — verified live that resolving an already-resolved thread twice does not duplicate a notification; list/unread-count/mark-one-read/mark-all-read (`/api/notifications...`, user-scoped not workspace-scoped, `JwtAuthGuard` only)
- [x] `Attachment` entity + `AttachmentsService` — MinIO direct-to-storage upload (presigned PUT), confirm step re-validates actual uploaded size via `statObject` (never trusts the client-declared size), size (20MB) and MIME allowlist enforced both at request time and confirm time, download via presigned GET, remove deletes both the MinIO object and the DB row; binaries never touch Postgres
- [x] Comment content is a failed-notification-enqueue-safe operation: `CommentsService.safeEnqueue` catches/logs enqueue failures rather than surfacing them as a failed comment request, since the comment DB transaction has already committed by that point (see the BullMQ colon-in-jobId bug below)
- [x] Frontend: `CommentsPanel` (list/reply/resolve/reopen/edit/delete + a mention picker that shows explicit `@member` chips rather than parsing free text), `NotificationsBell` (top-nav bell + unread badge, polls unread count every 20s, dropdown lists/marks-read), `AttachmentsPanel` (upload via file input → presigned PUT → confirm, list, open via presigned download URL, remove) — all wired into `CollaborativeEditor`'s toolbar alongside "History", following the same slide-over-panel shape as `VersionHistoryPanel`
- [x] Docker-deployment bug found and fixed: presigned upload/download URLs were signed against the internal Docker hostname (`MINIO_ENDPOINT=minio`), unreachable from a browser outside the Docker network. Fixed via a second `MinioService` client configured with `MINIO_PUBLIC_ENDPOINT`/`MINIO_PUBLIC_PORT` (defaults to the internal values when unset, so non-Docker local dev needs no change) — see ADR-016
- [x] Metrics: `comments_created_total{kind}`, `comment_threads_resolved_total{action}`, `notifications_processed_total{result}`, `notification_processing_failures_total`, `attachment_uploads_total{result}`

### Public Sharing, SSR/ISR & SEO (Stage 7)
- [x] `Document` gained `isPublished`/`publicSlug`/`publishedAt` columns (no new table - publishing is 1:1 with a document, same pattern as `archivedAt`). `publicSlug` is a plain unique index (Postgres allows multiple NULLs). Slug generation reuses `workspaces/slug.util.ts`'s `slugify`/`slugSuffix` collision-retry pattern
- [x] `POST .../documents/:id/publish` `{slug?}` / `POST .../documents/:id/unpublish` on the existing `DocumentsController` (no new controller/permission - reuses `assertCanEditDocument`, same boundary as every other document mutation: VIEWER blocked, EDITOR/ADMIN/OWNER allowed). Publishing is idempotent-on-republish (same slug reused unless a new one is requested); unpublishing is idempotent (no-op if already unpublished)
- [x] **Publishing model: "latest state"** (Model A) - the public page always reflects the document's current durable content; publish/unpublish only toggle visibility + slug, never snapshot content. Archiving a document (or any document in an archived subtree) automatically clears its publish state - archived + published can never coexist; publishing an already-archived document is rejected (400)
- [x] Public read path: `GET /api/public/documents/:slug` (`backend/src/modules/public/`, **zero auth guards** - the only such controller in the app) - reads the durable Yjs buffer via the existing `CollaborationPersistenceService.hydrate()` + `yjs-document.util.ts` decode/snapshot helpers, **never** an in-memory live collaboration session; returns only `{title, blocks, publishedAt}` - no workspace/document/user ids, no comments, no attachments, no version history
- [x] Public route `/p/[slug]` (frontend) - a plain **Server Component**, no `"use client"`, no editor reuse; fetches the backend's public API server-side with `next: {revalidate: 60, tags: [...]}` for ISR. `generateMetadata` sets title/description/canonical/Open Graph/Twitter tags; `robots.ts` allows `/` and `/p/`, disallows `/workspace/`, `/login`, `/register`, `/invitations/`
- [x] On-demand revalidation: publish/unpublish/republish/archive call `RevalidationService` → `POST {frontend}/api/revalidate` (shared-secret protected) → `revalidateTag(..., {expire: 0})` + `revalidatePath(...)`; the 60s ISR window is the fallback for ordinary content edits, which don't individually trigger a revalidation call (avoids coupling into the Yjs persistence throttle) — see ADR-017
- [x] Read-only renderer `PublicDocumentView` (`features/publishing/`) - a separate component from the editable `BlockView`, supports all Stage 4 block types (paragraph/heading/bulletListItem-grouped-into-`<ul>`/checkbox/codeBlock/image). All text renders as plain JSX children (React's automatic escaping is the XSS defense, verified live with an actual `<script>`/`onerror` payload - came back HTML-entity-escaped in the rendered page, confirmed via curl); `sanitizeUrl` allowlists `http`/`https` schemes for the one attribute-position value (image `src`)
- [x] Frontend sharing UX: `PublishControl` (`features/documents/`) - a small inline control (not a slide-over panel, since there's no list to browse) on the document page: Publish/Unpublish buttons, public URL + Copy link + Open, loading/error states
- [x] Two real bugs found via live Docker verification and fixed: (1) `RevalidationService`'s backend→frontend call used the browser-facing `FRONTEND_URL`, unreachable from inside the backend container - fixed with a new `FRONTEND_INTERNAL_URL` (Docker DNS), the same internal/public split pattern as Stage 6's MinIO fix; (2) the app's root `loading.tsx` implicitly wraps every route in a Suspense boundary, so `/p/[slug]`'s `notFound()` fired only after the response had already streamed a 200 status (documented Next.js 16 behavior, not fixable from the page itself) - fixed by checking document existence in `proxy.ts` before rendering starts, which now returns a real 404 pre-stream; see ADR-018
- [x] Metrics: `documents_published_total`, `documents_unpublished_total`, `public_render_failures_total`, `public_revalidation_failures_total`

### Frontend
- [x] `AuthProvider` (Client) — silent session bootstrap via refresh on mount, in-memory access token, `apiFetch` with 401-retry-once-via-refresh, `getAccessToken()` for the WS handshake (Stage 4)
- [x] `/login`, `/register` (Client forms, basic validation)
- [x] `/workspace` dashboard (list workspaces, create workspace, pending invitations with accept/reject)
- [x] `/workspace/[workspaceId]` shell (members list, role change/remove, invite form — all role-gated in the UI; backend re-enforces)
- [x] `/workspace/[workspaceId]/document/[documentId]` — document page shell: breadcrumb (ancestor chain), inline-editable title, archived banner + restore, real collaborative block editor with a "History" version panel (Stage 5)
- [x] `DocumentSidebar` (Client, lives in `/workspace/[workspaceId]/layout.tsx` so it persists across navigation) — nested tree with expand/collapse, create root/child, inline rename, up/down sibling reorder, archive, collapsible archived list with restore; all mutation controls role-gated (VIEWER sees a read-only tree)
- [x] `/invitations/[token]` standalone accept/reject page (email-link flow)
- [x] `WorkspaceSwitcher` (top bar, links between workspaces)
- [x] `proxy.ts` redirect-if-no-cookie for `/workspace/*`; also gates `/p/*` (Stage 7) to guarantee a real 404 status for unpublished/nonexistent slugs - see ADR-018
- [x] `/p/[slug]` public document page (Stage 7) - Server Component, no auth, SSR/ISR

### Testing (verified by running, not assumed)
- [x] Backend unit tests: **179 passing** (`npm test`) — permission matrix, password verification, refresh rotation/reuse, invitation expiration/email-matching, document tree/ordering/archive/restore/IDOR/publish/unpublish/slug-collision (Stage 7), `CollaborationService` session lifecycle/awareness/eviction cleanup, `CollaborationPersistenceService` hydrate/flush/throttle, `yjs-document.util` decode/serialize/replace, `VersionsService` list/inspect/create/restore, `CommentsService`/`NotificationsService`/`AttachmentsService` (Stage 6), `PublicDocumentsService` (Stage 7: 404-when-unpublished, decodes durable state, empty-blocks-when-never-edited, never leaks private fields, render-failure metric)
- [x] Backend e2e tests: **94 passing** (`npm run test:e2e`, real Postgres/Redis) — full auth lifecycle, workspace/invitation flow, VIEWER security, tenant isolation, document flows A–G, 10 collaboration tests, 10 versions tests, 28 Stage 6 tests, plus 11 Stage 7 tests covering all 13 critical scenarios: publish→public-view-no-auth→unpublish-removes-access, never-published/unpublished slug 404s, VIEWER blocked, outsider/cross-workspace IDOR on publish/unpublish, slug collision handled safely (two same-titled docs get distinct resolvable slugs), archiving auto-unpublishes (and re-publishing an archived doc is rejected), public response shape has no private fields, a stored `<script>` payload round-trips as an inert JSON string field (not raw HTML) via the API, content published while editing survives an in-memory session eviction (durable-state proof), and editing content after publishing changes the public response without a new publish call (Model A)
- [x] Frontend tests: **69 passing** (`npm test`, vitest) — email/password validation, permission-matrix UI gating, invitation/document/collaboration/versions/comments/notifications/attachments/publish-unpublish API call shapes, document tree-building, text-diff algorithm, `isSafeUrl`/`sanitizeUrl` (Stage 7 XSS-defense unit tests)

## Not Implemented

- Drag-and-drop reordering in the sidebar (shipped simple up/down sibling controls instead — see ADR-012)
- Billing, plan limits
- Search
- Publishing captures only "current title + blocks" - no per-publication custom OG image, no author byline, no published-content diffing/history (a published page has no relation to Stage 5's version history)
- Published attachments/images hosted in MinIO - the block model's `image` type is still a raw external `imageUrl` string (Stage 4 limitation, unchanged), so there's no "publish this workspace's MinIO-hosted attachment publicly" flow; not built since no block currently references a Stage 6 `Attachment` entity to begin with
- A lightweight existence-only check endpoint for `proxy.ts`'s pre-render 404 gate (Stage 7) - it currently reuses the full content endpoint, which is simple but technically against Next's own "keep proxy checks fast" guidance; acceptable at this project's scale, worth revisiting if public traffic grows
- Real email/push delivery for notifications — in-app only (persistent `Notification` rows + polling), per explicit Stage 6 scope
- Yjs-relative-position comment anchoring to specific text ranges — comments reference `documentId` only; not required by any concrete Stage 6 requirement, deliberately not built speculatively
- Comment threading beyond two levels (root + flat replies only, no reply-to-reply)
- Ownership transfer
- Position rebalancing (fractional positions never renumbered; not a practical concern at Stage 3 scale — see ADR-011)
- Real email delivery (invitations only work via dev-mode token exposure or in-app by-id accept)
- Full multi-step Yjs sync-protocol negotiation (`y-protocols/sync` step1/step2) - still uses a simplified always-send-full-state-on-join bootstrap, correct but not bandwidth-optimal for very large documents (see ADR-013)
- Append-only update log + compaction for durability - Stage 5 chose "one upserted full-state row per document" instead (simpler, no replay-time growth); a real high-write-volume system might prefer the log+compaction approach (see ADR-014)
- Git-like branching/diffing of versions - restore is whole-document only, no partial/selective restore
- A real persistence/eviction strategy bound to memory pressure - eviction is time-based (grace period) only, not memory-aware
- Interactive browser verification (clicking through the actual UI in a browser tab) has never been performed in this environment - no browser automation was available in any stage. Every stage instead verified its real behavior live via HTTP/socket.io-client scripts against the rebuilt Docker stack: Stage 6 exercised the full comment/mention/notification/attachment lifecycle including a real MinIO PUT/GET byte round-trip; Stage 7 published/viewed/edited/unpublished a real document end-to-end via curl against `localhost:3001`/`localhost:4000`, inspected the raw rendered HTML (confirming real content and SEO tags in the initial response, and confirming a stored `<script>` payload came back HTML-entity-escaped, never executable), and confirmed the public URL returns a true 404 after unpublish. Frontend build/lint/typecheck/tests passed on both stages
