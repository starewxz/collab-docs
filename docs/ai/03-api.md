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
| POST `/by-id/:id/accept` | JWT | authorizes by email match; used by the dashboard (no raw token available client-side) |
| POST `/by-id/:id/reject` | JWT | same |
| POST `/:token/accept` | JWT | email-link flow; 404/409/410/403 for not-found/already-used/expired/wrong-email |
| POST `/:token/reject` | JWT | same validations |

## Operational

| Method & Path | Notes |
|---|---|
| GET `/health` | Terminus: postgres/redis/minio, 503 if any down |
| GET `/health/live` | liveness only, no dependency checks |
| GET `/metrics` | Prometheus exposition (`http_requests_total`, `http_request_duration_seconds`, `auth_login_total{result}`, `workspaces_created_total`, `workspace_invitations_total{status}`) |
| GET `/docs` | Swagger UI |
