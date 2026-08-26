export interface AppConfig {
  nodeEnv: string;
  port: number;
  frontendUrl: string;
  backendUrl: string;
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
}

export interface JwtConfig {
  accessSecret?: string;
  refreshSecret?: string;
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
    backendUrl: process.env.BACKEND_URL!,
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
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },
});
