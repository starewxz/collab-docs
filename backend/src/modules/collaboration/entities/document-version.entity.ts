import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DocumentVersionKind } from '../document-version-kind.enum';

/**
 * Durable Yjs CRDT state. `state` is always a full `Y.encodeStateAsUpdate`
 * blob (binary, never JSON/plain text) - never an incremental diff, so
 * reconstructing a document is always a single `Y.applyUpdate` away.
 *
 * One row per (documentId) with kind=AUTO is upserted in place on a
 * throttled interval as the durability buffer - this is what survives a
 * server restart, and is never shown to users. MANUAL and RESTORE_POINT
 * rows accumulate as explicit, user-visible history and are never
 * overwritten. See ADR in docs/ai/08-decisions.md.
 */
@Entity('document_versions')
@Index(['documentId', 'createdAt'])
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  documentId: string;

  @Column({
    type: 'enum',
    enum: DocumentVersionKind,
    enumName: 'document_version_kind',
  })
  kind: DocumentVersionKind;

  @Column({ type: 'bytea' })
  state: Buffer;

  /** Null only for AUTO rows - no single actor triggers a periodic buffer
   * flush. Always populated for MANUAL/RESTORE_POINT. */
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
