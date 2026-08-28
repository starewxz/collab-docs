import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationType } from '../notification-type.enum';

/**
 * `dedupeKey` is the idempotency guarantee: the BullMQ processor computes
 * it once per real-world event (e.g. `mention_<commentMentionId>`,
 * `reply_<replyCommentId>_<recipientId>`, `resolve_<commentId>_<epochMs>_
 * <recipientId>` - underscores, never `:`, since BullMQ rejects custom job
 * ids containing colons) and inserts with `ON CONFLICT (dedupeKey) DO
 * NOTHING` - a redelivered/retried job for the same event produces the
 * same key and is silently absorbed, while a genuinely new event (a fresh
 * mention, a later resolve/reopen cycle) always gets a fresh key.
 */
@Entity('notifications')
@Index(['userId', 'readAt', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: NotificationType,
    enumName: 'notification_type',
  })
  type: NotificationType;

  @Column({ type: 'uuid' })
  documentId: string;

  @Column({ type: 'uuid', nullable: true })
  commentId: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 255, unique: true })
  dedupeKey: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
