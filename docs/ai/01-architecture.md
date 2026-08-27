# Architecture

## Backend — modular monolith

`backend/src/`
```
app.module.ts        wires everything below
common/               filters, decorators, logging, metrics (cross-cutting)
config/                AppConfigService (typed env access), Joi validation
database/              TypeORM data-source, DatabaseModule, migrations/
redis/                 single ioredis client (@Global)
queue/                 BullMQ connection + QueueName enum (no processors yet)
storage/               MinioService (@Global, bucket ensure on boot)
health/                Terminus health module
modules/
  users/               User entity, UsersService, UserResponseDto
  auth/                AuthService/Controller, JwtAuthGuard, RefreshToken entity
  workspaces/          Workspace/Member/Invitation, permissions, guards
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
- `WorkspacePermissionsService` (`backend/src/modules/workspaces/workspace-permissions.service.ts`) is the only place role logic is expressed. Methods: `canInviteMembers`, `canChangeMemberRole`, `canRemoveMember`, `canLeaveWorkspace`, `canViewInvitations`, `canManageWorkspaceSettings`, plus future-ready `canCreateDocument`/`canEditDocument`. Each has an `assertCanX` throwing variant (`ForbiddenException`).
- Non-member accessing a workspace-scoped route → **404** (`WorkspaceMembershipGuard`). Member with insufficient role → **403** (permission service). This split is deliberate and consistent everywhere.

## Frontend — App Router

- Server Components by default (layouts, page shells, metadata).
- Client Components only where browser state/interactivity is required: `AuthProvider`, forms, workspace dashboard/shell (they need live, post-login data — Next.js Server Components cannot rotate cookies, which is why data-fetching for authenticated pages happens client-side; see `05-frontend.md`).
- `proxy.ts` (Next 16 renamed `middleware.ts`) does a cheap redirect-to-`/login` if no `refresh_token` cookie exists, for `/workspace/:path*` only. It is a UX shortcut, not authorization — the backend re-checks everything independently.
- Frontend talks to the backend **directly from the browser** (`NEXT_PUBLIC_API_URL`, `credentials: 'include'`) for all authenticated calls — there is no BFF/proxy layer for API calls.

## Infrastructure

| Service | Used by | Status |
|---|---|---|
| PostgreSQL | TypeORM, all entities | Active |
| Redis | `RedisModule` (shared client), BullMQ connection | Client wired, no feature uses it yet |
| BullMQ | `QueueModule` | Connection only, zero processors/queues registered |
| MinIO | `StorageModule` / `MinioService` | Bucket-ensure on boot, presigned URL methods exist, no upload endpoints yet |
| Docker Compose | postgres, redis, minio, backend, frontend | All healthchecked |

See `04-database.md` for schema, `03-api.md` for endpoints, `05-frontend.md` for frontend detail.
