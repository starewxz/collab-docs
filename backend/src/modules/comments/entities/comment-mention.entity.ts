import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per (comment, mentioned user). The unique index is what makes
 * "duplicate mentions must not create duplicate effects" a DB-level
 * guarantee rather than an app-level convention: re-mentioning the same
 * user in the same comment is a no-op insert, and this row's id is also
 * the natural idempotency key for the notification job it triggers.
 */
@Entity('comment_mentions')
@Index(['commentId', 'mentionedUserId'], { unique: true })
export class CommentMention {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  commentId: string;

  @Index()
  @Column({ type: 'uuid' })
  mentionedUserId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
