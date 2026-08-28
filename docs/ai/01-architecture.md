# Architecture

## Backend — modular monolith

`backend/src/`
```
app.module.ts        wires everything below
common/               filters, decorators, logging, metrics, revalidation (cross-cutting)
config/                AppConfigService (typed env access), Joi validation
database/              TypeORM data-source, DatabaseModule, migrations/
redis/                 single ioredis client (@Global) - backs BullMQ (Stage 6 notification queue)
queue/                 BullMQ connection + QueueName enum - NotificationsProcessor is the first real processor (Stage 6)
storage/               MinioService (@Global) - dual internal/public presigned-URL clients (Stage 6, ADR-016); attachments (Stage 6) is the first feature using it
health/                Terminus health module
modules/
  users/               User entity, UsersService, UserResponseDto
  auth/                AuthService/Controller, JwtAuthGuard, RefreshToken entity
  workspaces/          Workspace/Member/Invitation, permissions, guards
  documents/           Document entity (incl. Stage 7 isPublished/publicSlug/publishedAt), DocumentsService/Controller (tree/ordering/archive/publish)
  collaboration/       CollaborationGateway (socket.io) + CollaborationService (in-memory Yjs sessions)
                       + CollaborationPersistenceService (durable buffer) + VersionsService/Controller (history)
  comments/            Comment/CommentMention entities, CommentsService/Controller (Stage 6)
  notifications/       Notification entity, NotificationsService/Processor/Controller (Stage 6)
  attachments/         Attachment entity, AttachmentsService/Controller - MinIO presigned upload/download (Stage 6)
  public/              PublicDocumentsService/Controller - the only unauthenticated controller in the app (Stage 7)
```

Each business module: **Controller (HTTP) → Service (domain logic) → TypeORM Repository (persistence)**. Controllers never contain domain logic.

### Request flow (protected workspace route)

```
Request
  ↓
JwtAuthGuard            verifies access token → req.user {sub, email}
  ↓
WorkspaceMembershipGuard  loads WorkspaceMember for (workspaceId, user) → req.membership, else 404
  ↓
Controller               HTTP concerns only
  ↓
WorkspacePermissionsService  role check (assertCanX) → 403 if denied
  ↓
Service                  domain logic, transactions
  ↓
TypeORM → PostgreSQL
```

## Authorization model

- **Authentication** = `JwtAuthGuard` (is this a valid access token?).
- **Authorization** = `WorkspaceMembershipGuard` + `WorkspacePermissionsService` (can this user do this, in this workspace, right now?).
- Roles are **never** read from the JWT — only `sub`/`email` are in the token. Every permission check re-reads the current `WorkspaceMember.role` from the DB, so a role change takes effect on the next request with no new token needed.
- `WorkspacePermissionsService` (`backend/src/modules/workspaces/workspace-permissions.service.ts`) is the only place role logic is expressed. Methods: `canInviteMembers`, `canChangeMemberRole`, `canRemoveMember`, `canLeaveWorkspace`, `canViewInvitations`, `canManageWorkspaceSettings`, `canCreateDocument`, `canEditDocument` (enforced by `DocumentsController`, including its Stage 7 `publish`/`unpublish` routes - no separate "sharing" permission was added), `canComment`, `canModerateComments` (Stage 6, enforced by `CommentsController`). Each has an `assertCanX` throwing variant (`ForbiddenException`).
- `DocumentsModule` imports `WorkspacesModule` to reuse `WorkspacePermissionsService`/`WorkspaceMembershipGuard`, but also independently registers `TypeOrmModule.forFeature([Document, WorkspaceMember])` — `@UseGuards(WorkspaceMembershipGuard)` resolves the guard's own constructor dependencies (the `WorkspaceMember` repository) within the *consuming* module's scope, not the module that originally provided it, even though it's exported. Any future module reusing this guard needs the same repository registered locally.
- Non-member accessing a workspace-scoped route → **404** (`WorkspaceMembershipGuard`). Member with insufficient role → **403** (permission service). This split is deliberate and consistent everywhere.
- `CollaborationGateway` can't use `JwtAuthGuard`/`WorkspaceMembershipGuard` directly - both read `context.switchToHttp().getRequest()`, which doesn't exist in a WS context. It re-verifies the JWT itself in `handleConnection` (same `JwtService`/`AppConfigService` secret) and re-queries `WorkspaceMember` itself in the `join` handler (same query shape as the guard) - same authorization outcome, HTTP-independent implementation. See ADR-013.

### Document-level ACL (post-Stage-10 — ADR-022)

- `DocumentPermissionsService` (`backend/src/modules/documents/document-permissions.service.ts`) is a second, orthogonal authorization axis layered on top of `WorkspacePermissionsService.canEditDocument` - same "two independent checks must both pass" pattern as `EntitlementsService` vs. workspace role.
- Resolution order (`resolveAccess(document, userId, role)`): (1) OWNER/ADMIN always get full access - administrative override; (2) an explicit `DocumentCollaborator` row for this user wins outright in either direction - it can grant view access to a `restricted` document, or cap a workspace EDITOR down to view-only (or, if simply absent, nothing) on that one document; (3) no row + `restricted` → denied entirely; (4) no row + not `restricted` → falls back to the workspace-role behavior every pre-existing document already had, so nothing changes for a document that never opts in.
- Enforced identically over REST (`DocumentsController` re-fetches the document via `documentsService.get()` and calls `documentPermissions.assertCanView`/`assertCanEdit`/`filterVisible`) and over `/collab`'s `join` handler (same `resolveAccess` call) - one implementation, two call sites, not two authorization systems.
- Managing the ACL itself (toggling `restricted`, sharing/unsharing a `DocumentCollaborator`) is gated by the new `WorkspacePermissionsService.canManageDocumentAccess` (OWNER/ADMIN), not `canEditDocument` - granting/restricting access is treated as a permission-tier action, same bar as changing a member's role.

## Realtime collaboration (Stage 4)

```
Socket connects to /collab (auth: {token} in the socket.io handshake)
  ↓
handleConnection    verifies the JWT the same way JwtAuthGuard does → socket.data.user, else disconnect
  ↓
client emits "join" {workspaceId, documentId}
  ↓
handleJoin          workspace membership → document exists in that workspace (DocumentsService.get,
                     same IDOR-safe scoped lookup as REST) → canEdit = canEditDocument(role) && !archived
  ↓
socket joins room "document:<id>"; CollaborationService lazily creates that document's
Y.Doc + Awareness (first joiner only) and registers this connection
  ↓
server sends the joining client the full current Y.Doc state + current awareness states
  ↓
"sync-update" (client→server, rejected if !canEdit) is applied and relayed to the room
"awareness-update" (either direction) flows through the same per-document Awareness instance
  ↓
disconnect          CollaborationService removes exactly this socket's awareness states,
                     broadcasts the removal, decrements connection/session gauges
```

A document id is never trusted from the client without the membership + existence + role checks above running first, on every `join` - not just on the first message from a given IP/session.

## Durable persistence & version history (Stage 5)

```
First join for a documentId in this process
  ↓
CollaborationGateway.getOrCreateHydratedSession    session doesn't exist yet →
                                                    CollaborationPersistenceService.hydrate()
                                                    loads the AUTO row, Y.applyUpdate into the new Y.Doc
  ↓
Every accepted client edit (handleSyncUpdate)      persistence.scheduleFlush() - trailing-throttled
                                                    (default 3s), upserts the single AUTO row
  ↓
Last client disconnects                            CollaborationService.scheduleEviction() - 30s grace
                                                    period; a rejoin within it cancels eviction and
                                                    reuses the live session
  ↓
Grace period elapses with zero connections          onEvict flushes final state, then evicts the
                                                    in-memory session (Awareness destroyed, no leak)
```

Version history is a separate, REST-facing concern (`VersionsService`/`VersionsController`) built on the *same* `document_versions` table, using `kind='manual'`/`'restore-point'` rows instead of the `'auto'` durability row:
- **Create**: snapshots current state (live session's `Y.Doc` if one is open, else the durable buffer, else empty) into a new `manual` row.
- **Restore**: captures current state as a `restore-point` row **first** (history is never destroyed), then calls `CollaborationGateway.applyRestoredState` - which decodes the target version, replaces the live doc's block list via `replaceBlocksContent` (content-level replace inside one Yjs transaction, not a raw CRDT merge - merges can only add operations, never remove ones made since), and broadcasts the resulting diff to every connected client over the same `/collab` room used for normal edits.

See ADR-013/014 in `08-decisions.md` for why a CRDT merge can't implement "restore," and why the durability buffer is one upserted row instead of an append-only log.

### Public edit-by-link (post-Stage-10 — ADR-023)

`CollaborationGateway.handlePublicJoin` (`join-public {slug}`) is a second, anonymous entry point alongside the JWT-scoped `join`: `handleConnection` no longer rejects a socket with no handshake token outright (only an *invalid* one), so an anonymous client can stay connected long enough to emit `join-public`. That handler resolves the document via the same `DocumentsService.findPublishedBySlug` the public REST read uses (already excludes unpublished/archived/expired), admits only if `publicAccessMode === 'edit'`, and hands the resulting session `canEdit: true`, `role: null` - there is no path from an anonymous session to any other document, workspace metadata, or membership data. Both `join` and `join-public` funnel into a shared private `completeJoin` for the room/hydration/ack tail; only the authorization step above it differs.

## Frontend — App Router

- Server Components by default (layouts, page shells, metadata). `/p/[slug]` (Stage 7) additionally streams: the page shell has no data dependency and flushes immediately, while a nested `async` Server Component wrapped in `<Suspense>` does the backend fetch and streams in once it resolves (post-Stage-10 — see `05-frontend.md`). Authenticated pages (dashboard/shell) are **not** converted to this pattern - see the next bullet for why.
- Client Components only where browser state/interactivity is required: `AuthProvider`, forms, workspace dashboard/shell (they need live, post-login data — Next.js Server Components cannot rotate cookies, which is why data-fetching for authenticated pages happens client-side; see `05-frontend.md`). This is also why authenticated mutations stayed client-side `apiFetch` calls rather than becoming Server Actions wholesale - a Server Action independently reading/rotating the refresh-token cookie would race the client's own refresh cycle over the same rotating token, which the backend's reuse detection would treat as a replay and revoke every session. The two Server Actions that do exist (`features/workspaces/actions.ts`) take the caller's current access token as a plain bound argument instead - see ADR-028.
- `proxy.ts` (Next 16 renamed `middleware.ts`) does a cheap redirect-to-`/login` if no `refresh_token` cookie exists, for `/workspace/:path*` only. It is a UX shortcut, not authorization — the backend re-checks everything independently.
- Frontend talks to the backend **directly from the browser** (`NEXT_PUBLIC_API_URL`, `credentials: 'include'`) for all authenticated calls — there is no BFF/proxy layer for API calls. (The two Server Actions above are a deliberate, scoped exception - see ADR-028.)

## Infrastructure

| Service | Used by | Status |
|---|---|---|
| PostgreSQL | TypeORM, all entities | Active |
| Redis | `RedisModule` (shared client), BullMQ connection | Active - backs the `NOTIFICATIONS` queue (Stage 6) and, post-Stage-10, the `SEARCH_INDEX` queue (ADR-024) and the workspace document-tree read cache (`DocumentsService`, key `doc-tree:<workspaceId>`, ADR-025) via the same shared client |
| BullMQ | `QueueModule` | `NotificationsProcessor` (Stage 6) and `SearchIndexProcessor` (post-Stage-10, ADR-024) are the two real processors; both idempotent via something stronger than BullMQ's own `jobId` dedup alone - see ADR-015/024 |
| MinIO | `StorageModule` / `MinioService` | Active - Stage 6 attachments upload/download via presigned URLs, dual internal/public clients (ADR-016) |
| Docker Compose | postgres, redis, minio, backend, frontend | All healthchecked; backend↔frontend also talk directly over the Docker network for Stage 7's on-demand revalidation call (ADR-017) |

See `04-database.md` for schema, `03-api.md` for endpoints, `05-frontend.md` for frontend detail.
