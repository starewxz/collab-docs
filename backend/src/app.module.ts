import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/app-config.module';
import { LoggingModule } from './common/logging/logging.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { RevalidationModule } from './common/revalidation/revalidation.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { CommentsModule } from './modules/comments/comments.module';
import { PublicModule } from './modules/public/public.module';
import { BillingModule } from './modules/billing/billing.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    MetricsModule,
    RevalidationModule,
    HealthModule,
    UsersModule,
    AuthModule,
    BillingModule,
    WorkspacesModule,
    DocumentsModule,
    CollaborationModule,
    NotificationsModule,
    AttachmentsModule,
    CommentsModule,
    PublicModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
