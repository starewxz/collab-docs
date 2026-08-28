# API

All routes prefixed `/api`. Full request/response schemas: **Swagger at `/api/docs`**. This file is a compact index only.

Policy: workspace-scoped routes return **404** for non-members, **403** for members with insufficient role.

## Auth (`auth.controller.ts`)

| Method & Path | Auth | Notes |
|---|---|---|
| POST `/auth/register` | none (rate-limited 20/60s) | argon2id hash, sets refresh cookie, returns access token |
| POST `/auth/login` | none (rate-limited 5/60s) | generic error on bad email/password |
| POST `/auth/refresh` | refresh cookie | rotates refresh token, reuse of old token revokes all sessions |
| POST `/auth/logout` | refresh cookie | idempotent, clears cookie |
| GET `/auth/me` | JWT | returns `UserResponseDto` (no passwordHash) |

## Workspaces (`workspaces.controller.ts`)

| Method & Path | Auth | Role | Notes |
|---|---|---|---|
| POST `/workspaces` | JWT | any | creates workspace + OWNER membership (1 transaction) |
| GET `/workspaces` | JWT | any | only workspaces the caller is a member of |
| GET `/workspaces/:workspaceId` | JWT + membership | any member | 404 if not a member |

## Members (`members.controller.ts`, base `/workspaces/:workspaceId/members`)

| Method & Path | Role | Notes |
|---|---|---|
| GET `/` | any member | public-safe member list |
| PATCH `/:memberId` | OWNER (any non-owner), ADMIN (EDITOR/VIEWER only) | cannot target/promote-to OWNER |
| DELETE `/:memberId` | same rule as PATCH | cannot remove OWNER |
| DELETE `/me` | any non-OWNER | self-leave; OWNER blocked |

## Invitations — workspace-scoped (`workspace-invitations.controller.ts`, base `/workspaces/:workspaceId/invitations`)

| Method & Path | Role | Notes |
|---|---|---|
| POST `/` | OWNER/ADMIN | role must be ADMIN/EDITOR/VIEWER (not OWNER); 409 if already a member or active invite exists |
| GET `/` | OWNER/ADMIN | all invitations for the workspace |

## Invitations — global (`invitations.controller.ts`, base `/invitations`)

| Method & Path | Auth | Notes |
|---|---|---|
| GET `/me` | JWT | invitations matching caller's normalized email, with computed `status` |
| POST `/by-id/:id/accept` | JWT | authorizes by email match; used by the dashboard (no raw token available client-side); same Stage 8 `PLAN_LIMIT_EXCEEDED` check as the token-flow accept above |
| POST `/by-id/:id/reject` | JWT | same |
| POST `/:token/accept` | JWT | email-link flow; 404/409/410/403 for not-found/already-used/expired/wrong-email; also 403 `PLAN_LIMIT_EXCEEDED` if the workspace is at its plan's member limit (Stage 8 - checked here, at accept time, not at invite-creation time) |
| POST `/:token/reject` | JWT | same validations |

## Documents (`documents.controller.ts`, base `/workspaces/:workspaceId/documents`)

| Method & Path | Role | Notes |
|---|---|---|
| POST `/` | any non-VIEWER | `{title, parentId?}`; 404 if `parentId` doesn't resolve inside this workspace; 400 if parent archived; 403 `PLAN_LIMIT_EXCEEDED` if the workspace is at its plan's document limit (Stage 8, `EntitlementsService`) |
| GET `/` | any member | `?includeArchived=true` to include archived; flat list ordered by `position` (not grouped — rebuild the tree client-side by `parentId`) |
| GET `/:documentId` | any member | scoped by `(id, workspaceId)` together — 404, not 403, for a cross-workspace id |
| PATCH `/:documentId` | any non-VIEWER | `{title}` rename only |
| POST `/:documentId/move` | any non-VIEWER | `{parentId, referenceId?, placement?}`; `parentId: null` = workspace root; rejects self-parent, cycles, cross-workspace parents, archived documents/targets (400) |
| DELETE `/:documentId` | any non-VIEWER | archives the **entire subtree**, 204; also clears `isPublished`/`publishedAt` for any published documents in that subtree (Stage 7) and triggers frontend revalidation for their slugs |
| POST `/:documentId/restore` | any non-VIEWER | restores the **entire subtree**; reparents to root if the original parent is still archived/gone |
| POST `/:documentId/publish` | any non-VIEWER | `{slug?}` (Stage 7); 400 if archived; normalizes/collision-retries the slug (same pattern as workspace slugs); idempotent-on-republish (keeps the current slug unless a new one is requested); triggers frontend revalidation for old+new slugs if the slug changed |
| POST `/:documentId/unpublish` | any non-VIEWER | idempotent no-op if already unpublished; triggers frontend revalidation for the (now-invalid) slug |
| GET `/search` | any member | `?q=&limit=&offset=` (Stage 8); registered before `:documentId` so it isn't matched as a document id; workspace-scoped + `archivedAt IS NULL`; `websearch_to_tsquery` full-text match over title+content, `ts_rank`-ordered, `ts_headline` snippet; returns `DocumentSearchResultDto[]` (`{id, title, snippet, parentId, updatedAt}`), max `limit` 50 |

## Public documents (`public-documents.controller.ts`, base `/public/documents` — Stage 7, **no auth guards at all**)

| Method & Path | Notes |
|---|---|
| GET `/:slug` | 404 unless a document exists with this exact `publicSlug` AND `isPublished=true` AND not archived; response is `{title, blocks, publishedAt}` only — no workspace/document/user ids, no comments/attachments/version data; content is read from the durable Yjs buffer (`CollaborationPersistenceService.hydrate`), never a live collaboration session |

## Document versions (`versions.controller.ts`, base `/workspaces/:workspaceId/documents/:documentId/versions`)

| Method & Path | Role | Notes |
|---|---|---|
| GET `/` | any member | history only (`manual`/`restore-point`); the `auto` durability buffer is never listed |
| GET `/:versionId` | any member | decodes stored Yjs state into plain `blocks` for preview; scoped by `(id, documentId)` — IDOR-safe |
| POST `/` | any non-VIEWER | `{label?}`; snapshots current live/persisted state; 400 if document archived; 403 `PLAN_LIMIT_EXCEEDED` on FREE (Stage 8 - manual snapshots are a PRO-gated feature; restore and the automatic durability buffer are never gated) |
| POST `/:versionId/restore` | any non-VIEWER | captures current state as a new `restore-point` version **first**, then replaces live content and broadcasts the diff to connected clients; 400 if document archived |

## Comments (`comments.controller.ts`, base `/workspaces/:workspaceId/documents/:documentId/comments`)

| Method & Path | Role | Notes |
|---|---|---|
| GET `/` | any member | flat comments grouped into root threads + `replies[]`; a deleted root hides its whole thread |
| POST `/` | any non-VIEWER (`assertCanComment`) | `{content, parentCommentId?, mentionedUserIds?}`; 400 if replying to a reply (max 2 levels), replying to a deleted comment, or document archived; `mentionedUserIds` validated against workspace membership (400 if any id isn't a member) |
| PATCH `/:commentId` | author only, always (no admin override) | `{content, mentionedUserIds?}`; diffs old vs new mentions, only notifies newly-added ones |
| DELETE `/:commentId` | author, or OWNER/ADMIN (`canModerateComments`) | 204, soft-delete; **not** blocked on an archived document (deliberate asymmetry vs. create/update/resolve) |
| POST `/:commentId/resolve` | any non-VIEWER | only a thread root can be resolved (400 for a reply); idempotent (no-op + no notification if already resolved) |
| POST `/:commentId/reopen` | any non-VIEWER | same idempotency as resolve |

## Notifications (`notifications.controller.ts`, base `/notifications` — user-scoped, `JwtAuthGuard` only, no workspace membership guard)

| Method & Path | Notes |
|---|---|
| GET `/` | `?unreadOnly=true` filters; newest first, capped at 100 |
| GET `/unread-count` | `{count}` |
| POST `/:id/read` | 204, scoped by `(id, userId)` together — IDOR-safe |
| POST `/read-all` | 204 |

## Billing (`billing.controller.ts`, base `/workspaces/:workspaceId/billing` — Stage 8)

| Method & Path | Role | Notes |
|---|---|---|
| GET `/` | any member | `SubscriptionResponseDto`: `{plan, status, currentPeriodEnd, members: {used, limit}, documents: {used, limit}, storageBytes: {used, limit}, features}`; `limit: null` means unlimited (PRO) |
| POST `/checkout` | OWNER (`assertCanManageWorkspaceSettings`) | returns a mock `{sessionId, checkoutUrl}` from `MockPaymentProvider` — no real redirect target; kept as the provider-swap seam for a future real Stripe integration |
| POST `/mock-pay` | OWNER | dev-only stand-in for a real provider's async webhook confirmation — immediately upgrades to PRO via the same idempotent `BillingService.applyEvent` core the webhook uses |
| POST `/downgrade` | OWNER | reverts to FREE; never deletes documents/members/attachments — see ADR-020 |

## Billing webhook (`billing-webhook.controller.ts`, base `/billing/webhook` — Stage 8, **no JWT guard, excluded from Swagger**)

| Method & Path | Notes |
|---|---|
| POST `/` | `x-billing-webhook-secret` header checked against `BILLING_WEBHOOK_SECRET` (stands in for a real provider's signature verification, e.g. Stripe's `Stripe-Signature`); body is `WebhookEventDto` (`{eventId, workspaceId, type: 'checkout.completed'\|'subscription.canceled', plan?: 'pro'}`); idempotent by `eventId` (unique DB column, `ON CONFLICT DO NOTHING`) — redelivering the same `eventId` is a safe no-op |

## Attachments (`attachments.controller.ts`, base `/workspaces/:workspaceId/documents/:documentId/attachments`)

| Method & Path | Role | Notes |
|---|---|---|
| GET `/` | any member | |
| POST `/` | any non-VIEWER (`canEditDocument`) | `{filename, mimeType, size}`; 400 if size > 20MB or MIME not in the allowlist; 403 `PLAN_LIMIT_EXCEEDED` if the additional bytes would exceed the plan's storage allowance (Stage 8); creates a `PENDING` row + returns a presigned PUT `uploadUrl` (client PUTs bytes directly to MinIO, never proxied through the backend) |
| POST `/:attachmentId/confirm` | any non-VIEWER | re-checks the **actual** uploaded size via MinIO `statObject` (never trusts the declared size); 400 + deletes the object+row if oversized or nothing was uploaded; flips status to `READY` |
| GET `/:attachmentId/download-url` | any member | 400 if not yet `READY`; returns a short-lived presigned GET URL |
| DELETE `/:attachmentId` | any non-VIEWER | 204, deletes both the MinIO object and the DB row |

## Collaboration (`collaboration.gateway.ts`, socket.io namespace `/collab` - not a REST route, not in Swagger)

| Direction | Event | Notes |
|---|---|---|
| connect | handshake `auth: {token}` | JWT verified the same way as `JwtAuthGuard`; invalid/missing → disconnect |
| client → server | `join` `{workspaceId, documentId}` | workspace membership + document existence (workspace-scoped) + `canEditDocument` checked before anything else; failure → `join-error` + disconnect |
| server → client | `joined` `{documentId, canEdit, role, self}` | ack; `canEdit=false` for VIEWER or an archived document |
| server → client | `sync-update` (binary) | full Y.Doc state on join; a relayed edit thereafter |
| client → server | `sync-update` (binary) | a Yjs update; rejected (`update-rejected`, not applied/relayed) if `!canEdit` |
| either direction | `awareness-update` (binary) | `y-protocols/awareness` presence (cursor, user); relayed to the whole `document:<id>` room |
| server → client | `update-rejected` `{reason}` | e.g. `"read-only"` |

## Operational

| Method & Path | Notes |
|---|---|
| GET `/health` | Terminus: postgres/redis/minio, 503 if any down |
| GET `/health/live` | liveness only, no dependency checks |
| GET `/metrics` | Prometheus exposition (`http_requests_total`, `http_request_duration_seconds`, `auth_login_total{result}`, `workspaces_created_total`, `workspace_invitations_total{status}`, `documents_created_total`, `documents_archived_total`, `document_operations_total{operation}`, `collab_connections_current`, `collab_sessions_current`, `crdt_updates_total`, `collab_connection_errors_total{reason}`, `collab_persist_total{result}`, `collab_versions_created_total{kind}`, `collab_version_restore_total{result}`, `collab_session_hydrated_total`, `collab_session_evicted_total`, `comments_created_total{kind}`, `comment_threads_resolved_total{action}`, `notifications_processed_total{result}`, `notification_processing_failures_total`, `attachment_uploads_total{result}`, `documents_published_total`, `documents_unpublished_total`, `public_render_failures_total`, `public_revalidation_failures_total`, `search_requests_total`, `search_failures_total`, `plan_limit_rejections_total{limit}`, `subscription_state_changes_total{result}`, `billing_webhook_failures_total` — Stage 8, no workspace/user/document ids as labels) |
| GET `/docs` | Swagger UI |
