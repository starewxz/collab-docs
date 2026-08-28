export enum DocumentVersionKind {
  /** Durable copy of the live buffer, upserted on a throttled interval so
   * content survives a restart - never shown in user-facing history. */
  AUTO = 'auto',
  /** Explicit user-triggered snapshot, shown in version history. */
  MANUAL = 'manual',
  /** Auto-captured copy of the current state right before a restore, so
   * restoring never destroys history. Shown in version history. */
  RESTORE_POINT = 'restore-point',
}
