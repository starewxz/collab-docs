export enum AttachmentStatus {
  /** Presigned upload URL issued, bytes not yet confirmed in MinIO. */
  PENDING = 'pending',
  /** Confirmed via statObject - size/type are the actual observed values. */
  READY = 'ready',
}
