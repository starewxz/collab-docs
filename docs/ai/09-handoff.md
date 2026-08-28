# Agent Handoff

## Current Stage

None in progress. Stage 7 (Public Sharing, SSR/ISR & SEO) is done. Next up per the roadmap is **Stage 8 — Growth** (search, billing, plan limits), not yet started.

## Read First

- `docs/ai/00-context.md`
- `docs/ai/01-architecture.md`
- `docs/ai/02-current-state.md`
- `docs/ai/06-rules.md`
- this file

## Stable Existing Infrastructure

Auth, workspaces, RBAC, invitations, documents (CRUD/tree/ordering/archive/restore/publish), realtime collaboration (Yjs sync + presence over `/collab`), durable persistence + version history, comments/mentions/notifications/attachments (Stage 6), public sharing + SSR/ISR + SEO (Stage 7) — all implemented and tested (179 backend unit + 94 backend e2e + 69 frontend tests, all passing as of this handoff, verified against a freshly rebuilt Docker stack including full live publish/edit/revalidate/unpublish/XSS verification via curl). Don't re-verify from scratch; trust `02-current-state.md`, spot-check only what you're about to touch.

## Current Objective

None assigned yet. When Stage 8 is requested: search, billing, plan limits, per `07-roadmap.md`. This is new functionality layered on top of the existing workspace/document/publishing model, not a redesign of any prior stage.

## Reuse (exact names)

- `WorkspacePermissionsService`/`WorkspaceMembershipGuard` — the authorization backbone every stage has used; plan limits would naturally live here or in a new sibling service, not a parallel system.
- `Document`/`DocumentsService`, including its Stage 7 `isPublished`/`publicSlug` fields — if search needs to index content, the durable Yjs buffer (`CollaborationPersistenceService.hydrate` + `yjs-document.util.ts`'s `decodeState`/`encodeBlocksSnapshot`) is already the canonical "current plain-text content" source; `PublicDocumentsService` is a direct usage example.
- BullMQ + idempotent-processing pattern (`dedupeKey` unique column + `ON CONFLICT DO NOTHING`, ADR-015) — the template for any new async job (e.g. search indexing, billing webhook processing).
- The internal-vs-public URL split pattern (ADR-016 for MinIO, ADR-017 for the frontend) — if billing needs a webhook endpoint or another cross-container call, check whether it needs the internal-DNS or browser-facing address before wiring it up; this class of bug has bitten twice already.
- `RevalidationService` (`common/revalidation/`) — reusable for any future on-demand ISR invalidation need, not just publishing.
- Frontend `features/*/api.ts` + slide-over-panel conventions, plus the Stage 7 pattern of a plain unauthenticated Server Component page (`app/p/[slug]/`) for public-facing UI.

## Do Not Touch

- Auth architecture (JWT strategy, refresh rotation, cookie config) unless a concrete Stage 8 requirement forces it.
- Document tree/CRUD/ordering/archive/publish logic, the live sync/presence/persistence pipeline, or the Stage 6/7 modules (comments/notifications/attachments/public) — Stage 8 builds alongside them, doesn't rewrite them.
- Docker/CI/logging/metrics foundation.
- `WorkspacePermissionsService`'s existing methods — add to it, don't restructure it.
- `proxy.ts`'s `/p/*` existence-check gate (ADR-018) — it's a deliberate, documented workaround for a real Next.js streaming/`notFound()` interaction, not incidental code to simplify away.

## Do Not Start Yet

Stage 9 (frontend polish), Stage 10 (hardening).

## Known follow-ups from Stage 6/7 (not blockers, just worth knowing)

- Notifications are in-app only — no email/push delivery.
- No deep-link from a notification to the document/workspace that triggered it.
- Comments have no text-range/Yjs-relative-position anchoring.
- Publishing has no per-publication custom OG image or author byline; a published page has no relation to Stage 5's version history (it's always "latest state", per ADR-017).
- The block model's `image` type is still a raw external URL string (Stage 4), not a Stage 6 `Attachment` reference — there is no "publish this workspace's MinIO-hosted file publicly" flow.
- `proxy.ts`'s `/p/*` existence check reuses the full public-content endpoint rather than a lightweight existence-only one - simple, but technically against Next's own "keep proxy checks fast" guidance; fine at this project's scale.
- Interactive browser click-through of the UI has never been performed in this environment (no browser automation available in any stage) - every stage has instead been verified live via real HTTP/socket.io-client/curl scripts against local and Docker-built backends/frontend, plus build/lint/test on both sides.
