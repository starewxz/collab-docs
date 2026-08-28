# Agent Handoff

## Current Stage

None in progress. Stage 8 (Search, Billing & Plan Limits) is done. Next up per the roadmap is **Stage 9 — Frontend Completion & UX**, not yet started.

## Read First

- `docs/ai/00-context.md`
- `docs/ai/01-architecture.md`
- `docs/ai/02-current-state.md`
- `docs/ai/06-rules.md`
- this file

## Stable Existing Infrastructure

Auth, workspaces, RBAC, invitations, documents (CRUD/tree/ordering/archive/restore/publish), realtime collaboration (Yjs sync + presence over `/collab`), durable persistence + version history, comments/mentions/notifications/attachments (Stage 6), public sharing + SSR/ISR + SEO (Stage 7), workspace-scoped search (Postgres FTS) + billing/plan limits (Stage 8) — all implemented and tested (199 backend unit + 109 backend e2e + 74 frontend tests, all passing as of this handoff, verified against a freshly rebuilt Docker stack including a live curl-driven register→workspace→document→search→mock-pay round trip). Don't re-verify from scratch; trust `02-current-state.md`, spot-check only what you're about to touch.

## Current Objective

None assigned yet. When Stage 9 is requested: a UX completion pass across all prior stages, per `07-roadmap.md`. This is polish/completion of existing functionality, not new backend domains.

## Reuse (exact names)

- `WorkspacePermissionsService`/`WorkspaceMembershipGuard` — the authorization backbone every stage has used; `EntitlementsService` (Stage 8) is the parallel, deliberately-separate plan/entitlement axis — don't merge the two.
- `features/*/api.ts` + slide-over-panel conventions (`VersionHistoryPanel`/`CommentsPanel`/`AttachmentsPanel`) — the established shape for any new panel-style UI.
- `components/ui/{Button,Input,Card,Spinner,EmptyState}` — the only shared primitives; no Dialog/Modal component exists yet beyond Stage 8's one-off `SearchDialog` (not extracted into `components/ui` since nothing else needed a generic modal shell yet - worth doing if Stage 9 adds a second one).
- `lib/api-error.ts`'s `isApiError`/`isPlanLimitError` — any new error-surfacing UI should check `isPlanLimitError` first (structured `code`/`limitType`/`limit`/`current`/`plan`) before falling back to a generic message, now that `GlobalExceptionFilter` actually preserves those fields (Stage 8 fix).
- The internal-vs-public URL split pattern (ADR-016 MinIO, ADR-017 frontend revalidation) — check whether any new cross-container call needs the internal-DNS or browser-facing address; this class of bug has bitten multiple times.
- `PLAN_LIMITS` (`backend/src/modules/billing/plan-limits.ts`) — the one place plan numbers live; if Stage 9 adds any UI that displays or reasons about limits, read from the `GET .../billing` response, never hardcode a number.

## Do Not Touch

- Auth architecture (JWT strategy, refresh rotation, cookie config) unless a concrete Stage 9 requirement forces it.
- Document tree/CRUD/ordering/archive/publish logic, the live sync/presence/persistence pipeline, search/billing/entitlement logic (Stage 8), or the Stage 6/7 modules (comments/notifications/attachments/public) — Stage 9 is a UX pass on top of these, not a rewrite.
- Docker/CI/logging/metrics foundation.
- `WorkspacePermissionsService`'s existing methods, `EntitlementsService`'s existing assertions — add to them if a concrete need arises, don't restructure.
- `proxy.ts`'s `/p/*` existence-check gate (ADR-018) — a deliberate, documented workaround, not incidental code to simplify away.
- `GlobalExceptionFilter`'s extra-field preservation (ADR-020's fix) — needed by any structured-error UI, not just billing's.

## Do Not Start Yet

Stage 10 (hardening).

## Known follow-ups from Stage 8 (not blockers, just worth knowing)

- No real payment provider (Stripe or otherwise) - Stage 8 shipped a mock/dev billing flow behind a `PaymentProvider` interface boundary specifically designed so a real integration only replaces `MockPaymentProvider` + deletes the dev-only `mock-pay` shortcut; `applyEvent`/the webhook controller stay as-is. Not required by the original scope.
- Only FREE/PRO exist; no third tier.
- Search covers document title + content only (Postgres FTS) - comments, version history, and attachment metadata are explicitly out of scope, per the original Stage 8 requirement.
- `SearchDialog` is a one-off component, not extracted into `components/ui` as a reusable Dialog/Modal primitive - fine for now since it's the only modal in the app, but the next thing needing a modal shell should probably extract one rather than copy-pasting the backdrop/panel/escape-key pattern.
- Attachment storage limit enforcement is a lighter count-then-check with no transactional lock (documented, accepted trade-off given uploads are already async/two-phase) - unlike document/member limits, which are lock-serialized. If storage ever needs to be a true hard invariant, it would need the same `lockWorkspace` treatment.
- No customer portal / "manage subscription" UI beyond the in-app Upgrade/Downgrade buttons - not applicable without a real payment provider behind it.
- Interactive browser click-through of the UI has never been performed in this environment (no browser automation was available in any stage, including Stage 8 where the Claude-in-Chrome extension wasn't connected when attempted) - every stage has instead been verified live via real HTTP/socket.io-client/curl scripts against local and Docker-built backends/frontend, plus build/lint/test on both sides. If Stage 9 is a UX-focused pass, actually getting browser automation working (or having a human click through) would be unusually valuable here specifically, more so than in prior backend-heavy stages.
