import type { NotificationType } from './notification-type.enum';

/**
 * The job payload IS the idempotency contract: `dedupeKey` is computed
 * once by the producer (CommentsService) per real-world event and never
 * changes across BullMQ retries of that same job, so the queue (via
 * `jobId: dedupeKey`) and the DB (via a unique column, `ON CONFLICT DO
 * NOTHING`) both naturally absorb redelivery without special-casing it.
 */
export interface NotificationJobPayload {
  dedupeKey: string;
  userId: string;
  type: NotificationType;
  documentId: string;
  commentId: string | null;
  actorId: string | null;
}
