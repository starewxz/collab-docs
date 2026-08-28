import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { IsNull, Repository } from 'typeorm';
import { Document } from '../documents/entities/document.entity';
import { MetricsService } from '../../common/metrics/metrics.service';
import { QueueName } from '../../queue/queue.constants';
import { Notification } from './entities/notification.entity';
import type { NotificationJobPayload } from './notification-job.types';
import type { NotificationType } from './notification-type.enum';

/** `list()`'s shape - `workspaceId` is derived via a join against
 * `documents`, never stored on `Notification` itself (Stage 9). */
export interface NotificationWithWorkspace {
  id: string;
  type: NotificationType;
  workspaceId: string;
  documentId: string;
  commentId: string | null;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue(QueueName.NOTIFICATIONS) private readonly queue: Queue,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext(NotificationsService.name);
  }

  /** Enqueues async processing. `jobId: dedupeKey` makes BullMQ itself
   * reject a duplicate enqueue of the same event while the original job is
   * still known to the queue; the DB-level unique constraint in
   * `createIfNotExists` is the durable guarantee that survives job
   * retention expiring. */
  async enqueue(payload: NotificationJobPayload): Promise<void> {
    await this.queue.add('create-notification', payload, {
      jobId: payload.dedupeKey,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  /** Called by NotificationsProcessor. Safe to call twice with the same
   * dedupeKey - the second call is a no-op, which is exactly what makes
   * redelivered/retried jobs idempotent. */
  async createIfNotExists(payload: NotificationJobPayload): Promise<void> {
    const result = await this.notifications
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values({
        userId: payload.userId,
        type: payload.type,
        documentId: payload.documentId,
        commentId: payload.commentId,
        actorId: payload.actorId,
        dedupeKey: payload.dedupeKey,
      })
      .orIgnore()
      .execute();

    // Real TypeORM/Postgres ON CONFLICT DO NOTHING still returns one
    // `identifiers` entry per input row, but `null` for a skipped
    // (duplicate) row - checking `.length` alone would treat every
    // redelivered/retried job as newly created. See ADR-020's identical
    // finding in BillingService.applyEvent (Stage 8).
    const inserted = result.identifiers.some((id) => id != null);
    this.metrics.notificationsProcessedTotal.inc({
      result: inserted ? 'created' : 'duplicate',
    });
    this.logger.info(
      {
        event: inserted
          ? 'notification_created'
          : 'notification_duplicate_skipped',
        type: payload.type,
        documentId: payload.documentId,
      },
      inserted ? 'notification_created' : 'notification_duplicate_skipped',
    );
  }

  /** Explicit per-field `.select()`/`.addSelect()` + `.getRawMany()`
   * throughout, deliberately avoiding `getRawAndEntities()` - mixing that
   * with a manually-computed join column (`workspaceId`) is exactly the
   * TypeORM pitfall ADR-019 already found once in DocumentsService.search()
   * (silently wrong/missing fields from internal auto-aliasing collisions). */
  async list(
    userId: string,
    unreadOnly: boolean,
  ): Promise<NotificationWithWorkspace[]> {
    const qb = this.notifications
      .createQueryBuilder('n')
      .innerJoin(Document, 'd', 'd.id = n."documentId"')
      .select('n.id', 'id')
      .addSelect('n.type', 'type')
      .addSelect('d."workspaceId"', 'workspaceId')
      .addSelect('n."documentId"', 'documentId')
      .addSelect('n."commentId"', 'commentId')
      .addSelect('n."actorId"', 'actorId')
      .addSelect('n."readAt"', 'readAt')
      .addSelect('n."createdAt"', 'createdAt')
      .where('n."userId" = :userId', { userId })
      .orderBy('n."createdAt"', 'DESC')
      .limit(100);
    if (unreadOnly) {
      qb.andWhere('n."readAt" IS NULL');
    }
    return qb.getRawMany<NotificationWithWorkspace>();
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, readAt: IsNull() } });
  }

  /** Scoped by (id, userId) together - a user can only ever mark their own
   * notifications read, the same IDOR-safe pattern used everywhere else. */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.notifications.update(
      { id: notificationId, userId },
      { readAt: new Date() },
    );
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }
}
