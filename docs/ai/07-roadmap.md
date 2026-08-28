# Roadmap

## Stage 1 — Foundation — DONE
Next.js + NestJS scaffolding, Postgres/TypeORM, Redis, BullMQ connection, MinIO client, Docker Compose, health/metrics/logging/correlation IDs, Swagger, CI.

## Stage 2 — Auth + Workspaces + RBAC + Invitations — DONE
Register/login/refresh-rotation/logout/me, Workspace + WorkspaceMember + WorkspaceInvitation, `WorkspacePermissionsService`, member management, invitation accept/reject (token + by-id), frontend auth + dashboard + workspace shell. See `02-current-state.md` for the full checklist.

## Stage 3 — Document Foundation — DONE
`Document` entity (workspace-scoped, self-referencing tree, fractional `position`), CRUD + move/reorder + archive/restore (whole-subtree), cycle/self-parent/cross-workspace prevention, IDOR-safe `(id, workspaceId)` scoped lookups throughout, authorization reused from `WorkspacePermissionsService`, frontend sidebar tree + document page shell. See `02-current-state.md` for the full checklist and ADR-011/012 in `08-decisions.md` for the ordering/archive and reordering-UI decisions.

## Stage 4 — Realtime Collaboration — DONE
`CollaborationGateway` (socket.io, `/collab` namespace) with one in-memory `Y.Doc` + `Awareness` per active document; join-time authorization (JWT + workspace membership + document existence + `canEditDocument`); CRDT sync via relayed `sync-update` messages (no "save whole document" endpoint); presence via `y-protocols/awareness`; reconnect/resync via idempotent full-state re-sync on rejoin. Frontend: CRDT-backed block model (paragraph/heading/bulletListItem/checkbox/codeBlock/image) and a `CollaborativeEditor` wired into the Stage 3 document page. See `02-current-state.md` for the full checklist and ADR-013 in `08-decisions.md` for the in-memory-only persistence and simplified-sync decisions.

## Stage 5 — Persistence & History — DONE
Durable Yjs state via `document_versions` (binary `bytea`, `AUTO`/`MANUAL`/`RESTORE_POINT` kinds; one upserted `AUTO` row per document is the durability buffer, throttled writes, survives a real Docker restart - verified live). Version history (list/inspect/create/restore) reuses existing workspace/document authorization. Restore preserves history (captures current state as a `RESTORE_POINT` first) and broadcasts the resulting diff live so connected clients converge without reloading. Conservative time-based session eviction with a grace period. Frontend `VersionHistoryPanel` wired into the Stage 4 editor. See `02-current-state.md` for the full checklist and ADR-014 in `08-decisions.md` for the persistence-model and restore-semantics decisions.

## Stage 6 — Social — DONE
Comments (two-level threads, resolve/reopen, author-only edit + OWNER/ADMIN moderated delete), `@mention` validation against workspace membership, persistent in-app notifications delivered via a real BullMQ queue with DB-level idempotent processing (`dedupeKey` unique constraint), MinIO-backed attachments (presigned upload/download, size/MIME validation, actual-size re-check on confirm). Comments/attachments authorization reuses `WorkspacePermissionsService`/`WorkspaceMembershipGuard`, not a parallel system. Frontend: `CommentsPanel`/`NotificationsBell`/`AttachmentsPanel` following the `VersionHistoryPanel` slide-over shape. See `02-current-state.md` for the full checklist and ADR-015/016 in `08-decisions.md` for the notification-idempotency and dual-MinIO-endpoint decisions.

## Stage 7 — Public & SEO — DONE
Publish/unpublish/republish (`Document.isPublished`/`publicSlug`/`publishedAt`, no new table), reusing `assertCanEditDocument` for permissions. Public read path is a dedicated, fully unauthenticated module reading the durable Yjs buffer (never a live session) and returning only `{title, blocks, publishedAt}`. Public pages (`/p/[slug]`) are plain Server Components with ISR (`revalidate: 60` + on-demand `revalidateTag`/`revalidatePath` on publish/unpublish/archive) and full SEO metadata (title/description/canonical/OG/Twitter, `robots.ts`). A dedicated read-only block renderer (not the editable one) relies on React's automatic JSX escaping for XSS safety, verified live with an actual script-tag payload. Two real cross-container bugs found and fixed via live Docker verification: a wrong-hostname backend→frontend revalidation call, and a Next.js streaming/`notFound()` interaction that silently served 200 instead of 404 (fixed in `proxy.ts`, which now gates `/p/*` pre-render). See `02-current-state.md` for the full checklist and ADR-017/018 in `08-decisions.md`.

## Stage 8 — Growth — DONE
Workspace-scoped document search (Postgres full-text via a generated `tsvector` column + GIN index — no new infrastructure dependency; indexes only the durable Yjs buffer, never a live session) with a Cmd/Ctrl+K frontend command dialog. Billing domain (`Subscription` 1:1 per workspace, FREE/PRO, mock payment provider behind a `PaymentProvider` boundary designed to be replaced by real Stripe later, idempotent webhook processing via a unique `eventId`). Centralized `EntitlementsService` (plan limits/features), deliberately separate from `WorkspacePermissionsService` (role authorization) - both must independently pass. Hard limits (document count, member count) enforced with transactional workspace-row locking to prevent concurrent-request bypass, verified live; storage limit uses a lighter, documented count-then-check. Downgrade never deletes data - existing count-based entitlement checks make that safe by construction. Frontend: `SearchDialog` + `BillingSection` (embedded in the existing workspace shell, not a new route), plus upgrade-path messaging on `PLAN_LIMIT_EXCEEDED` errors. Two real bugs found and fixed: the global exception filter was silently stripping structured error fields a frontend "upgrade CTA" needs, and the webhook idempotency check misread TypeORM's `orIgnore()` result shape, treating every duplicate delivery as newly-applied. See `02-current-state.md` for the full checklist and ADR-019/020 in `08-decisions.md`.

## Stage 9 — Frontend Polish
UX completion pass across all prior stages.

## Stage 10 — Hardening
Testing, security, observability, final audit.
