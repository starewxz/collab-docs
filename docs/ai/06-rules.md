# Development Rules

1. Inspect existing implementation before changing architecture — read `01-architecture.md` + relevant source, don't assume.
2. Don't rewrite working Stage 1/2/3/4/5 infrastructure without a concrete reason.
3. Strict TypeScript everywhere; avoid `any`.
4. Controllers hold HTTP concerns only — domain logic lives in services.
5. All workspace authorization goes through `WorkspacePermissionsService` — never inline `role === 'ADMIN'`.
6. Never trust a workspace role from a JWT claim — resolve current membership from the DB (`WorkspaceMembershipGuard`).
7. Non-member access to a workspace-scoped resource → 404. Member with insufficient role → 403. Keep this split consistent.
8. Always scope tenant resources by `workspaceId` in queries — never look up a member/invitation/document by id alone (IDOR).
9. TypeORM migrations only; never set `synchronize: true`.
10. Multi-write invariants (workspace+owner creation, invitation accept) use a DB transaction, with a DB unique/partial-unique constraint as the final concurrency guard — not just an app-level `if (!exists)` check.
11. Refresh tokens: httpOnly cookie only, hashed at rest, never localStorage. Access tokens: in-memory only on the frontend.
12. Never return `passwordHash`, token hashes, or raw refresh/invitation tokens outside their single intended response.
13. Server Components by default in the frontend.
14. Client Components only where browser interactivity or session state requires them — see `05-frontend.md` for the current boundary.
15. Don't weaken tests or security checks to make a build pass.
16. Don't claim a test/build/verification passed without actually running it.
17. Don't start future roadmap stages unless explicitly asked — check `07-roadmap.md` for current stage.
18. Don't commit unless the user asks.
19. After completing a stage, update `02-current-state.md`, `07-roadmap.md`, `09-handoff.md`, and `08-decisions.md` (only if an architectural decision changed).
20. Keep `docs/ai/` concise — one canonical home per fact, no duplication across files.

## Project-specific notes

- Rate limiters are per-route via `@Throttle`/`@SkipThrottle` with named buckets (`login`, `register`) — never register a global `ThrottlerGuard`, it will bleed onto unrelated routes.
- Invitation tokens are one-way hashed and cannot be recovered after creation — any new "list invitations" surface needs the `by-id` pattern (email-match authorization), not the raw token.
- `REFRESH_COOKIE_PATH` is `/` (not `/api/auth`) so the frontend's `proxy.ts` can see it — don't narrow this without checking that dependency.
