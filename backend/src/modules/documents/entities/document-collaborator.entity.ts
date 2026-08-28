import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum DocumentAccessLevel {
  VIEWER = 'VIEWER',
  EDITOR = 'EDITOR',
}

/**
 * Document-level access override, layered on top of the workspace role by
 * `DocumentPermissionsService`. A row here can either *extend* access to a
 * `restricted` document (see `Document.restricted`) or *restrict* a user
 * below what their workspace role would otherwise allow (e.g. a workspace
 * EDITOR whose row here is VIEWER can no longer edit this one document).
 * OWNER/ADMIN workspace roles always bypass this table (administrative
 * override - see `DocumentPermissionsService.resolveAccess`).
 */
@Entity('document_collaborators')
@Unique(['documentId', 'userId'])
export class DocumentCollaborator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  documentId: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: DocumentAccessLevel })
  accessLevel: DocumentAccessLevel;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
