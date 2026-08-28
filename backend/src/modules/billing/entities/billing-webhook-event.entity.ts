import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Idempotency ledger for provider webhook/mock-confirm events - the same
 * durable-unique-constraint pattern as Notification.dedupeKey (ADR-015).
 * `eventId` is whatever the provider calls its event id (a real Stripe
 * event has `evt_...`; the mock provider generates a UUID). A webhook
 * delivered twice (a very real occurrence for real providers, and
 * deliberately simulated in this project's tests) must apply its effect
 * exactly once.
 */
@Entity('billing_webhook_events')
export class BillingWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  eventId: string;

  @Column({ type: 'uuid' })
  workspaceId: string;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @CreateDateColumn({ type: 'timestamptz' })
  processedAt: Date;
}
