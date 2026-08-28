import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AppConfig,
  BillingConfig,
  JwtConfig,
  MinioConfig,
  PostgresConfig,
  RedisConfig,
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
}
