import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AppConfig,
  BillingConfig,
  JwtConfig,
  MinioConfig,
  PostgresConfig,
  RedisConfig,
  ThrottleConfig,
} from './configuration';

/**
 * Thin typed wrapper around ConfigService so the rest of the app never
 * touches string-keyed config lookups directly.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get app(): AppConfig {
    return this.configService.get<AppConfig>('app')!;
  }

  get postgres(): PostgresConfig {
    return this.configService.get<PostgresConfig>('postgres')!;
  }

  get redis(): RedisConfig {
    return this.configService.get<RedisConfig>('redis')!;
  }

  get minio(): MinioConfig {
    return this.configService.get<MinioConfig>('minio')!;
  }

  get jwt(): JwtConfig {
    return this.configService.get<JwtConfig>('jwt')!;
  }

  get billing(): BillingConfig {
    return this.configService.get<BillingConfig>('billing')!;
  }

  get throttle(): ThrottleConfig {
    return this.configService.get<ThrottleConfig>('throttle')!;
  }

  /** Security-sensitive behavior (secure cookies, hidden error detail, no
   * dev-token exposure in invitation responses) should treat `staging` the
   * same as `production` - it's a real, often-externally-reachable
   * deployment, not a developer's own machine. `staging` and `production`
   * still differ in everything else (database, domain, secrets, data) -
   * this only governs the small set of environment checks that exist
   * purely to make local development/testing more convenient and would be
   * a real leak anywhere else. */
  get isProductionLike(): boolean {
    return this.app.nodeEnv === 'production' || this.app.nodeEnv === 'staging';
  }
}
