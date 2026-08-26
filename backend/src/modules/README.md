Business modules live here as the product grows, one folder per domain, each a self-contained Nest module (controllers/services/entities/DTOs). None exist yet — Stage 1 is infrastructure only.

Reserved boundaries for later stages:

- `auth` — login, registration, JWT issuance/refresh
- `users` — user profiles and account management
- `workspaces` — workspace membership, invites, roles
- `documents` — document CRUD and metadata
- `collaboration` — Yjs/CRDT sync sessions, presence
- `comments` — inline and page-level comments
- `notifications` — in-app and email notifications
- `billing` — subscriptions and billing webhooks
- `search` — search indexing and querying
- `storage` — user-facing file upload/download endpoints (built on the low-level `storage/MinioService` infra already in place)
- `analytics` — usage analytics and metrics that are product-facing rather than operational
