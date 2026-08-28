# Database

PostgreSQL + TypeORM. **`synchronize: false` always** — migrations in `backend/src/database/migrations/` are authoritative. Entities are discovered by glob (`**/*.entity.ts`); no manual entity list to maintain.

Migrations: `1787748663603-EnableUuidExtension` (pgcrypto, so `gen_random_uuid()` works), `1787814681199-Migration` (full Stage 2 schema incl. FKs), `1787824727552-Migration` (`documents` table), `1787838816430-AddDocumentVersions` (`document_versions` table), `1787844286371-AddCommentsNotificationsAttachments` (`attachments`, `comments`, `comment_mentions`, `notifications` tables), `1787856112434-AddDocumentPublishing` (`documents.isPublished`/`publicSlug`/`publishedAt` + unique index), `1787899218514-AddBilling` (`subscriptions`, `billing_webhook_events` tables + a backfill giving every pre-existing workspace a default FREE/ACTIVE subscription row), `1787899718705-AddDocumentSearch` (`documents.contentText` + generated `searchVector` tsvector column + GIN index), `1787920200000-AddDocumentAccessControl` (post-Stage-10: `document_collaborators` table + `documents.restricted`/`publicAccessMode`/`publicExpiresAt` — see ADR-022/023). TypeORM's `migration:generate` doesn't emit FKs or partial indexes — every migration here was hand-completed after generation.

## User (`users`)
- `id` uuid PK, `email` varchar **unique**, `passwordHash` (`select: false` — never returned by default queries), `firstName`, `lastName`, timestamps.
- Email normalized (trim+lowercase) via `@BeforeInsert/@BeforeUpdate`.

## RefreshToken (`refresh_tokens`)
- `id`, `userId` (FK → users, cascade), `tokenHash` **unique** (HMAC-SHA256, keyed by `JWT_REFRESH_SECRET` — raw token never stored), `expiresAt`, `revokedAt` nullable, `replacedByTokenId` nullable (rotation chain), `userAgent` nullable.
- One row = one session. Reuse of a revoked token triggers "revoke all tokens for this userId".

## Workspace (`workspaces`)
- `id`, `name`, `slug` **unique** (auto-generated, collision-retried), `createdById` (FK → users, cascade).

## WorkspaceMember (`workspace_members`)
- `id`, `workspaceId` (FK → workspaces, cascade), `userId` (FK → users, cascade), `role` (enum `workspace_role`), `joinedAt`.
- **Unique composite index** `(workspaceId, userId)` — one membership per user per workspace, enforced at the DB level (final concurrency guard).

## WorkspaceInvitation (`workspace_invitations`)
- `id`, `workspaceId` (FK, cascade), `email` (indexed, not unique alone), `role` (enum), `tokenHash` **unique** (SHA-256, raw token never stored after creation), `invitedById` (FK → users, cascade), `expiresAt` (7 days), `acceptedAt`/`rejectedAt` nullable, `createdAt`.
- **Partial unique index** `(workspaceId, email) WHERE acceptedAt IS NULL AND rejectedAt IS NULL` — only one *active* invite per workspace+email at a time; expired/accepted/rejected rows don't block a new invite.
- Status is computed at read time (`pending`/`accepted`/`rejected`/`expired`), not stored as a column.

## WorkspaceRole (enum `workspace_role`, shared by member + invitation tables)
```
OWNER > ADMIN > EDITOR > VIEWER
```
`INVITABLE_ROLES = [ADMIN, EDITOR, VIEWER]` — OWNER can never be assigned via invitation or role change.

## Document (`documents`)
- `id`, `workspaceId` (FK → workspaces, cascade, indexed), `parentId` (FK → **documents** itself, cascade, nullable = root, indexed), `title` varchar(255), `position` double precision, `createdById` (FK → users, cascade), `archivedAt` nullable timestamptz (indexed), `isPublished` boolean default false, `publicSlug` nullable varchar(255) **unique** (Stage 7), `publishedAt` nullable timestamptz, `publicAccessMode` varchar(10) default `'view'` (`'view'`/`'edit'`, post-Stage-10 — ADR-023), `publicExpiresAt` nullable timestamptz (post-Stage-10 — ADR-023), `restricted` boolean default false (post-Stage-10 — ADR-022), `contentText` nullable text (`select: false`, Stage 8), `searchVector` **GENERATED ALWAYS** tsvector (Stage 8, DB-only — never mapped as an entity property), timestamps.
- Composite index `(workspaceId, parentId, position)` — the shape every list/reorder query filters and sorts by.
- `publicSlug`'s unique index is a plain (non-partial) unique index — Postgres treats multiple `NULL`s as distinct, so the common unpublished case never collides. Archiving always clears all three publish columns (see `DocumentsService.archive`) — archived + published never coexist.
- **No `parentPath`/materialized-path column** — the tree is walked live (bounded, max depth 1000) for cycle checks and subtree collection; acceptable at Stage 3 scale, revisit only if depth/fan-out grows large. See ADR-011.
- `ON DELETE CASCADE` on `parentId` means deleting a document row would cascade-delete its DB-level subtree — in practice this never fires, because the app never hard-deletes a document; archive/restore are soft (see ADR-011).
- `searchVector` (Stage 8): `GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce("contentText",'')), 'B')) STORED`, GIN-indexed. Postgres recomputes it automatically on any `title`/`contentText` UPDATE — no application code keeps it in sync. `contentText` is written only by `CollaborationPersistenceService.flush()` after a durable-buffer write (see ADR-019), capped at 20,000 characters.

## DocumentCollaborator (`document_collaborators`, post-Stage-10 — ADR-022)
- `id`, `documentId` (indexed, **not** an FK — matches this codebase's existing plain-uuid-column convention on `Document` for cross-references), `userId` (indexed), `accessLevel` (enum `document_collaborators_accesslevel_enum`: `VIEWER`/`EDITOR`), `createdAt`.
- **Unique composite index** `(documentId, userId)` — one override row per user per document; `DocumentPermissionsService.shareDocument` upserts rather than insert-or-conflict.
- Layered on top of `Document.restricted` and the workspace role by `DocumentPermissionsService.resolveAccess` — see `01-architecture.md`/`03-api.md` for the resolution order and ADR-022 for why.

## DocumentVersion (`document_versions`, Stage 5)
- `id`, `documentId` (FK → documents, cascade, indexed + composite-indexed with `createdAt`), `kind` (enum `document_version_kind`: `auto`/`manual`/`restore-point`), `state` **bytea** (full `Y.encodeStateAsUpdate` blob - binary, never JSON/plain text), `createdById` (FK → users, cascade, **nullable** - null only for `auto` rows), `label` nullable varchar(255), `createdAt`.
- **Partial unique index** `(documentId) WHERE kind = 'auto'` — exactly one durability-buffer row per document at all times, upserted in place (never appended to); `manual`/`restore-point` rows accumulate freely as user-visible history.
- `manual`/`restore-point` rows are never overwritten; `auto` rows are written via a trailing-throttled flush (default 3s, see ADR-014), not per keystroke.

## Comment (`comments`, Stage 6)
- `id`, `documentId` (FK → documents, cascade, indexed), `parentCommentId` (FK → **comments** itself, cascade, nullable = root, indexed) — service logic (not a DB constraint) rejects a reply targeting a non-root parent, keeping nesting at exactly two levels, `authorId` (FK → users, cascade), `content` text, `resolvedAt`/`resolvedById` nullable (root-only), `editedAt` nullable, `deletedAt` nullable indexed (soft-delete, same convention as `Document.archivedAt`), timestamps.
- Composite index `(documentId, parentCommentId, createdAt)` — the shape the threaded list query filters/sorts by.

## CommentMention (`comment_mentions`, Stage 6)
- `id`, `commentId` (FK → comments, cascade, indexed), `mentionedUserId` (FK → users, cascade, indexed), `createdAt`.
- **Unique composite index** `(commentId, mentionedUserId)` — DB-level backstop against duplicate mention rows; the primary de-dup happens in `CommentsService` (`Set` before insert) since it also needs to diff old-vs-new mentions on edit.

## Notification (`notifications`, Stage 6)
- `id`, `userId` (FK → users, cascade, indexed — recipient), `type` (enum `notification_type`: `mention`/`reply`/`thread_resolved`/`thread_reopened`), `documentId` (FK → documents, cascade), `commentId` (FK → comments, cascade, nullable), `actorId` (FK → users, cascade, nullable — who triggered it), `dedupeKey` **unique** varchar, `readAt` nullable, `createdAt`.
- **Unique** `dedupeKey` is the durable idempotency guarantee (`INSERT ... ON CONFLICT (dedupeKey) DO NOTHING`) — see ADR-015. Format uses **underscores**, never colons, as delimiters (e.g. `mention_<mentionId>`, `reply_<commentId>_<parentAuthorId>`, `resolve_<commentId>_<epochMs>_<authorId>`) — BullMQ rejects a custom `jobId` containing `:`, and `Date.toISOString()` itself contains colons, so timestamps in a dedupeKey use `.getTime()` (epoch ms) instead.
- Composite index `(userId, readAt, createdAt)` — the shape the unread-list/count queries filter/sort by.

## Attachment (`attachments`, Stage 6)
- `id`, `documentId` (FK → documents, cascade, indexed), `objectKey` **unique** varchar(512) (the MinIO object path, `attachments/<documentId>/<uuid>-<sanitized-filename>`), `filename`, `mimeType`, `size` **integer** (deliberately not `bigint` — TypeORM returns `bigint` columns as strings to avoid JS precision loss, which would be an unnecessary type headache given the 20MB max is nowhere near int32 range), `status` (enum `attachment_status`: `pending`/`ready`), `uploadedById` (FK → users, cascade), `createdAt`.
- Composite index `(documentId, createdAt)`. Binary content is never stored here — only MinIO object metadata/reference; the object itself lives in the `collab-docs` bucket.

## Subscription (`subscriptions`, Stage 8)
- `id`, `workspaceId` (FK → workspaces, cascade) **unique** — exactly one subscription row per workspace, created transactionally alongside the workspace itself (`BillingService.createDefaultSubscription`, called from `WorkspacesService.createWorkspace`), `plan` (enum `subscription_plan`: `free`/`pro`), `status` (enum `subscription_status`: `active`/`past_due`/`canceled`), `currentPeriodEnd` nullable timestamptz, `provider` varchar default `'mock'`, `providerCustomerId`/`providerSubscriptionId` nullable varchar, timestamps.
- Billing belongs to the **workspace**, never to an individual document — see ADR-020.

## BillingWebhookEvent (`billing_webhook_events`, Stage 8)
- `id`, `eventId` **unique** varchar(255) (whatever the provider calls its event id — a UUID for the mock provider), `workspaceId` (FK → workspaces, cascade), `type` varchar(64), `processedAt`.
- **Unique** `eventId` is the durable idempotency guarantee (`INSERT ... ON CONFLICT DO NOTHING`) for `BillingService.applyEvent` — the same pattern as `Notification.dedupeKey` (ADR-015). See ADR-020 for a real bug found in how the insert result was checked for "was this a duplicate."

## Key invariants
- Unique: `users.email`, `workspaces.slug`, `(workspace_members.workspaceId, userId)`, `refresh_tokens.tokenHash`, `workspace_invitations.tokenHash`, active `(workspace_invitations.workspaceId, email)`, `document_versions` active `(documentId) WHERE kind='auto'`, `(comment_mentions.commentId, mentionedUserId)`, `notifications.dedupeKey`, `attachments.objectKey`, `documents.publicSlug`, `subscriptions.workspaceId`, `billing_webhook_events.eventId`, `(document_collaborators.documentId, userId)`.
- Refresh tokens and invitation tokens are **hashed at rest**; raw values exist only transiently (response body / cookie).
- All FKs `ON DELETE CASCADE`.
- Every document lookup filters by `(id, workspaceId)` together, never `id` alone — the IDOR-protection pattern all document and version code follows.
