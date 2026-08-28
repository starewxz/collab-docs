# Agent Handoff

## Current Stage

**FINAL — Submission Ready, plus a post-Stage-10 TT gap closure pass.** Stage 10 (Final Testing, Security, Observability & Submission Audit) is complete. No later roadmap stage is defined.

The later submission-regression repair is also complete. Local Compose no longer overrides the backend to production security behavior (which incorrectly set `Secure` cookies on HTTP localhost), and document-tree DnD now computes zones from the pointer on every drag frame, avoids adjacent no-ops, and resyncs after rollback. These changes are intentionally uncommitted.

## Verified Final State

- Complete product domains: auth/refresh/logout, multi-tenant workspaces and RBAC, invitations, nested documents, Yjs collaboration/presence/reconnect, durable CRDT state and version restore, comments/mentions/notifications, MinIO attachments, public SSR/ISR pages (view **and** edit-by-link), search (sync full-text read path + async index writes), FREE/PRO entitlements, and document-level ACL layered on workspace roles.
- Tests run for this pass (rebuilt Docker stack): 221 backend unit, 122 backend e2e (1 known pre-existing flaky timing test — "Reconnect / resync" in `collaboration.e2e-spec.ts`, confirmed flaky on the *unmodified* codebase too under full-suite load, not a regression), 93 frontend vitest; backend/frontend lint, typecheck, and production builds all passed. Backend lint has the same two pre-existing test-only `no-unsafe-argument` warnings as every prior stage, zero errors.
- Docker Compose rebuilt from scratch with all changes; all five services report healthy. Verified live via curl/socket.io-client against the rebuilt stack: register→workspace→document→publish(edit mode)→public page round trip, document-level ACL over both REST and the gateway, async search indexing (not searchable immediately after edit, searchable after the queue processes), tree-cache invalidation, and the streamed public-page response (confirmed genuinely multi-chunk, not a client spinner).
- Browser automation was **unavailable in this environment** (same limitation noted every stage since Stage 6) — the DnD pointer gesture could not be exercised in a real browser. Its targeting resolver is unit-tested and all reorder/reparent/root/nested operations were verified through the live API, including persistence across a Compose restart.

## Post-Stage-10 Frontend Redesign

A full visual/UX redesign pass followed Stage 10 — every user-facing page restyled onto a new `app/globals.css` design-token system (color/type/spacing/radius/motion, dark mode via `prefers-color-scheme`), with new shared primitives (`IconButton`, `Badge`, `Avatar`, `Tabs`, `Tooltip`, `Menu`, `Skeleton`, `FormField`) and a hand-rolled icon set. No backend, API contract, or Yjs/CRDT behavior changed — see `02-current-state.md`'s "Frontend Visual Redesign" entry and `05-frontend.md`'s "UI" section for specifics.

## Post-Stage-10 Final TT Gap Closure

Eight specific gaps closed in one pass: document-level ACL, public edit-by-link + expiry, sidebar drag-and-drop, streaming SSR, Server Actions, async search indexing, a Redis document-tree read cache, and dev/staging config profiles. Full detail in `02-current-state.md`'s "Final TT Gap Closure" entry, `03-api.md`/`04-database.md` for the new endpoints/schema, `05-frontend.md` for the frontend pieces, and ADR-022 through ADR-028 in `08-decisions.md` for the reasoning behind each. Two real pre-existing-suite issues found and fixed while doing this: the `publishing.e2e-spec.ts` "public JSON has exactly these keys" test needed updating (not weakening) for the new, intentional `mode` field, and the working tree had a broken build state from an earlier uncommitted session (missing `globals.css`/`Button`/`Card`/`Input` CSS) — fixed as a side effect of the redesign pass, documented there.

## Stable Boundaries

- Keep `WorkspacePermissionsService` (authorization) separate from `EntitlementsService` (plan limits) separate from `DocumentPermissionsService` (document-level ACL) — three independent axes that must each pass, not one merged check. See ADR-020/022.
- Keep access tokens in memory and refresh tokens in the httpOnly cookie/hash-at-rest rotation model. Server Actions that need backend auth take the access token as a bound argument from the client — **never** have a Server Action independently read/exchange the refresh cookie (races the client's own refresh cycle against reuse-detection — see ADR-028).
- Keep public rendering sourced from durable Yjs state and rendered as escaped JSX; never introduce unsafe HTML. The anonymous `join-public` gateway path (edit-by-link) reuses the exact same `findPublishedBySlug` existence/expiry check as the public REST read — don't add a second, divergent check.
- Reuse `SlideOverPanel`, `ConfirmDialog`, `ToastProvider`, `useFocusTrap`, and the existing API-error formatting utilities.
- For new UI, reuse the `components/ui/` primitives and `app/globals.css` tokens introduced in the post-Stage-10 redesign rather than hand-rolling new styles or a second styling approach.
- Any new environment-gated security-sensitive behavior should check `AppConfigService.isProductionLike`, not a fresh `nodeEnv === 'production'` comparison (ADR-026).
- Any document-tree-shaping mutation in `DocumentsService` must call `invalidateTree(workspaceId)` (ADR-025) — grep for existing call sites before adding a ninth mutation method.
- Preserve the fixed non-null-identifier checks at the two TypeORM `orIgnore()` sites in billing and notifications.

## Known Non-blocking Limitations

The canonical list remains in `02-current-state.md`: mock rather than live Stripe, in-app/dev-token rather than email delivery, no text-range comment anchors, no upload progress bar, full-state Yjs bootstrap/persistence optimized for simplicity rather than very large documents, and external-URL image blocks separate from MinIO attachments. (Sidebar drag-and-drop, previously listed here, is now implemented — see ADR-027.)

## Operational Notes

- Do not commit unless explicitly asked.
- Copy `.env.example` to `.env` and provide strong JWT, revalidation, and billing webhook secrets before startup. For a staging deployment, layer `.env.staging.example` on top (see README's "Environments" section) — do not reuse development or production secrets.
- `docker compose up -d --build` now performs migrations automatically; verify all five health checks with `docker compose ps`. The new `1787920200000-AddDocumentAccessControl` migration must be present alongside the previous 8.
- The isolated `collab-audit` containers and volumes from Stage 10 were removed after verification; this pass's Docker rebuild reused the existing `next-test` stack/volumes in place (not a fresh volume) — verify against a clean volume before a real submission if that matters for the grading environment.
