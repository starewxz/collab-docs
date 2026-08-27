# Database

PostgreSQL + TypeORM. **`synchronize: false` always** — migrations in `backend/src/database/migrations/` are authoritative. Entities are discovered by glob (`**/*.entity.ts`); no manual entity list to maintain.

Migrations: `1787748663603-EnableUuidExtension` (pgcrypto, so `gen_random_uuid()` works), `1787814681199-Migration` (full Stage 2 schema incl. FKs — TypeORM's `migration:generate` doesn't emit FKs or partial indexes, so this one was hand-completed).

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

## Key invariants
- Unique: `users.email`, `workspaces.slug`, `(workspace_members.workspaceId, userId)`, `refresh_tokens.tokenHash`, `workspace_invitations.tokenHash`, active `(workspace_invitations.workspaceId, email)`.
- Refresh tokens and invitation tokens are **hashed at rest**; raw values exist only transiently (response body / cookie).
- All FKs `ON DELETE CASCADE`.
- No `Document` table/entity exists yet.
