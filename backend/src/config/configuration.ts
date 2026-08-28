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

export interface Configuration {
  app: AppConfig;
  postgres: PostgresConfig;
  redis: RedisConfig;
  minio: MinioConfig;
  jwt: JwtConfig;
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
});
