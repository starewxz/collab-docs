import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AttachmentStatus } from '../attachment-status.enum';

/**
 * Binary content lives only in MinIO (`objectKey`); this row is metadata
 * only. `size`/`mimeType` start as the client's declared values at upload-
 * URL-issue time and are overwritten with the actual `statObject` values
 * on confirm - the declared values are never trusted as final truth.
 */
@Entity('attachments')
@Index(['documentId', 'createdAt'])
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  documentId: string;

  @Column({ type: 'varchar', length: 512, unique: true })
  objectKey: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 255 })
  mimeType: string;

  // 'integer' (not 'bigint') is deliberate: TypeORM/pg returns bigint
  // columns as strings to avoid JS precision loss, which would fight the
  // `number` type here. Max attachment size is nowhere near int32 range.
  @Column({ type: 'integer' })
  size: number;

  @Column({
    type: 'enum',
    enum: AttachmentStatus,
    enumName: 'attachment_status',
    default: AttachmentStatus.PENDING,
  })
  status: AttachmentStatus;

  @Column({ type: 'uuid' })
  uploadedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
