import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/app-config.module';
import { LoggingModule } from './common/logging/logging.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    MetricsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
