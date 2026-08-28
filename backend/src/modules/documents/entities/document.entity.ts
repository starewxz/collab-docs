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
   * Public sharing mode (only meaningful while `isPublished`): 'view'
   * (read-only public page, the original Stage 7 behavior) or 'edit'
   * (anonymous visitors can collaboratively edit via the `/collab` gateway's
   * `join-public` event, scoped to exactly this document - see
   * CollaborationGateway.handlePublicJoin). Defaults to 'view' so every
   * pre-existing published document keeps its original read-only behavior.
   */
  @Column({ type: 'varchar', length: 10, default: 'view' })
  publicAccessMode: 'view' | 'edit';

  /** Optional public-link expiry. When set and in the past, the link is
   * treated exactly like an unpublished/nonexistent one (404) - see
   * `DocumentsService.findPublishedBySlug`. Null = never expires. */
  @Column({ type: 'timestamptz', nullable: true })
  publicExpiresAt: Date | null;

  /**
   * Document-level access control (see `document_collaborators` /
   * `DocumentPermissionsService`). When true, only OWNER/ADMIN workspace
   * roles and users with an explicit `DocumentCollaborator` row may view or
   * edit this document - the base workspace role alone is not enough, even
   * for a member who could normally edit any document. Defaults to false
   * so every pre-existing document keeps today's "any workspace member can
   * see it" behavior.
   */
  @Column({ type: 'boolean', default: false })
  restricted: boolean;

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
