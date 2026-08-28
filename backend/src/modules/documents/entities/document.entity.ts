import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Structure only - no editor/CRDT content lives here. Stage 4 attaches
 * collaborative content storage separately once this tree is stable.
 */
@Entity('documents')
@Index(['workspaceId', 'parentId', 'position'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  /**
   * Fractional sibling ordering: inserting between two siblings is
   * `(prev + next) / 2`, so a single insert/move never needs to renumber
   * other rows. See ADR in docs/ai/08-decisions.md.
   */
  @Column({ type: 'double precision' })
  position: number;

  @Column({ type: 'uuid' })
  createdById: string;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  /**
   * Stage 7 publishing. `publicSlug` is unique when set - Postgres unique
   * indexes treat NULLs as distinct from each other, so unpublished
   * documents (the common case) never collide. Archiving a document always
   * clears all three fields (see DocumentsService.archive) - an archived
   * document is never publicly visible, even if it was published before.
   */
  @Column({ type: 'boolean', default: false })
  isPublished: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  publicSlug: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /**
   * Stage 8 search: plain-text extraction of the document's current
   * durable Yjs state (block text joined with spaces, truncated - see
   * DocumentsService.updateSearchContent), kept in sync by
   * CollaborationPersistenceService.flush - never read from a live
   * in-memory Y.Doc directly. `searchVector` (title + contentText,
   * GENERATED ALWAYS AS ... STORED, GIN-indexed) is DB-managed and
   * deliberately not mapped here - the application never reads or writes
   * it as an entity property, only references it in raw SQL inside
   * DocumentsService.search.
   */
  @Column({ type: 'text', nullable: true, select: false })
  contentText: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
