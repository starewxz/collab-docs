import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Comments are a two-level structure only: a root comment (parentCommentId
 * null) starts a thread, and replies (parentCommentId = the root's id)
 * attach flatly underneath it - no reply-to-reply nesting. Resolve/reopen
 * only applies to root comments (the thread), enforced in CommentsService.
 * No Yjs-relative-position anchoring - comments attach to a document, not
 * a specific text range, per Stage 6 scope (keep it simple until a concrete
 * requirement demands anchoring).
 */
@Entity('comments')
@Index(['documentId', 'parentCommentId', 'createdAt'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  documentId: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  parentCommentId: string | null;

  @Column({ type: 'uuid' })
  authorId: string;

  @Column({ type: 'text' })
  content: string;

  /** Only meaningful on a root comment (parentCommentId IS NULL). */
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  /** Soft-delete: the row (and any replies under it) stay for thread
   * integrity; deleted comments are excluded from list responses. */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
