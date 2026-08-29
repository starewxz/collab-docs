export interface AppConfig {
  nodeEnv: string;
  port: number;
  /** Browser-facing origin - used for CORS checks and human-facing links
   * (invitation URLs). Never use this for a backend-to-frontend server
   * call - see `frontendInternalUrl`. */
  frontendUrl: string;
  /** Docker-DNS-reachable frontend origin, used only by
   * RevalidationService's backend -> frontend on-demand revalidation call.
   * Defaults to `frontendUrl` when unset, correct for non-Docker local dev
   * where both processes share the same host. */
  frontendInternalUrl: string;
  backendUrl: string;
  /**
   * Unset by default (host-only cookie - correct for localhost dev, where
   * the frontend/backend share a hostname across different ports). Set to
   * a shared parent domain (e.g. ".example.com") in production if the
   * frontend and backend live on different subdomains, so proxy.ts can
   * still see the refresh cookie for its optimistic redirect check.
   */
  cookieDomain?: string;
  /**
   * Shared secret for the frontend's `/api/revalidate` route (Stage 7
   * publishing). Unset in test/CI is fine - `RevalidationService` no-ops
   * silently when this is empty, since there's no frontend to call there.
   */
  revalidateSecret: string;
}

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface MinioConfig {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
  /**
   * Host/port/SSL used only when generating presigned upload/download URLs
   * - these URLs are handed to a browser client, which cannot resolve the
   * internal Docker network hostname (`endpoint`, e.g. "minio"). Defaults
   * to `endpoint`/`port`/`useSSL` when unset, which is correct for non-
   * Docker local dev where MinIO is already reachable at the same host.
   */
  publicEndpoint: string;
  publicPort: number;
  publicUseSSL: boolean;
}

export interface JwtConfig {
  accessSecret: string;
  accessExpiresInSeconds: number;
  refreshSecret: string;
  refreshExpiresInSeconds: number;
}

export interface ThrottleConfig {
  loginLimit: number;
  loginTtlMs: number;
  /**
   * Deliberately overridable per-environment: production keeps this tight
   * against registration spam, but the e2e suite legitimately registers
   * many accounts from one process within the same window (the comment on
   * AuthModule's bucket already carves out "test suites" as expected
   * traffic) - see .env.test / CI workflow for the raised test value.
   */
  registerLimit: number;
  registerTtlMs: number;
}

export interface BillingConfig {
  /** Shared secret the (mock) payment provider's webhook must present -
   * stands in for real signature verification (e.g. Stripe's
   * `Stripe-Signature` header + signing secret). Never sent to the
   * browser. Empty in test/CI is fine - the webhook route rejects every
   * call with 401 in that case, same fail-closed posture as a missing
   * Stripe signing secret would produce. */
  webhookSecret: string;
}

export interface Configuration {
  app: AppConfig;
  postgres: PostgresConfig;
  redis: RedisConfig;
  minio: MinioConfig;
  jwt: JwtConfig;
  billing: BillingConfig;
  throttle: ThrottleConfig;
}

export default (): Configuration => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '4000', 10),
    frontendUrl: process.env.FRONTEND_URL!,
    frontendInternalUrl:
      process.env.FRONTEND_INTERNAL_URL || process.env.FRONTEND_URL!,
    backendUrl: process.env.BACKEND_URL!,
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    revalidateSecret: process.env.REVALIDATE_SECRET ?? '',
  },
  postgres: {
    host: process.env.POSTGRES_HOST!,
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    database: process.env.POSTGRES_DB!,
  },
  redis: {
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT!,
    port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY!,
    secretKey: process.env.MINIO_SECRET_KEY!,
    bucket: process.env.MINIO_BUCKET!,
    useSSL: process.env.MINIO_USE_SSL === 'true',
    publicEndpoint:
      process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT!,
    publicPort: parseInt(
      process.env.MINIO_PUBLIC_PORT ?? process.env.MINIO_PORT ?? '9000',
      10,
    ),
    publicUseSSL:
      (process.env.MINIO_PUBLIC_USE_SSL ?? process.env.MINIO_USE_SSL) ===
      'true',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    accessExpiresInSeconds: parseInt(
      process.env.JWT_ACCESS_EXPIRES_IN_SECONDS ?? '900',
      10,
    ),
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    refreshExpiresInSeconds: parseInt(
      process.env.JWT_REFRESH_EXPIRES_IN_SECONDS ?? String(60 * 60 * 24 * 30),
      10,
    ),
  },
  billing: {
    webhookSecret: process.env.BILLING_WEBHOOK_SECRET ?? '',
  },
  throttle: {
    loginLimit: parseInt(process.env.THROTTLE_LOGIN_LIMIT ?? '5', 10),
    loginTtlMs: parseInt(process.env.THROTTLE_LOGIN_TTL_MS ?? '60000', 10),
    registerLimit: parseInt(process.env.THROTTLE_REGISTER_LIMIT ?? '20', 10),
    registerTtlMs: parseInt(
      process.env.THROTTLE_REGISTER_TTL_MS ?? '60000',
      10,
    ),
  },
});
