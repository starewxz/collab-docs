import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../common/metrics/metrics.service';
import { QueueName } from '../../queue/queue.constants';
import { NotificationsService } from './notifications.service';
import type { NotificationJobPayload } from './notification-job.types';

/** Runs in this same NestJS process (the modular-monolith convention -
 * ADR-001), not a separate worker deployment. */
@Processor(QueueName.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    super();
    this.logger.setContext(NotificationsProcessor.name);
  }

  async process(job: Job<NotificationJobPayload>): Promise<void> {
    try {
      await this.notificationsService.createIfNotExists(job.data);
    } catch (err) {
      this.metrics.notificationProcessingFailuresTotal.inc();
      this.logger.warn(
        {
          event: 'notification_processing_failed',
          error: (err as Error).message,
        },
        'notification_processing_failed',
      );
      throw err; // let BullMQ retry
    }
  }
}
