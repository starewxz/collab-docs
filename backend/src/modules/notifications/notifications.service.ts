import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { IsNull, Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { QueueName } from '../../queue/queue.constants';
import { Notification } from './entities/notification.entity';
import type { NotificationJobPayload } from './notification-job.types';

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

    const inserted = (result.identifiers?.length ?? 0) > 0;
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

  async list(userId: string, unreadOnly: boolean): Promise<Notification[]> {
    return this.notifications.find({
      where: unreadOnly ? { userId, readAt: IsNull() } : { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
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
