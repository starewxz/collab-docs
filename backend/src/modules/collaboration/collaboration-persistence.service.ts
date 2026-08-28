import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentVersionKind } from './document-version-kind.enum';
import { DocumentVersion } from './entities/document-version.entity';
import { decodeState, encodeBlocksSnapshot } from './yjs-document.util';

/** Trailing-throttle window: many rapid edits within this window collapse
 * into a single write, but a document being edited continuously still gets
 * flushed at least this often - bounding data-loss exposure to one window,
 * not "however long someone keeps typing". Overridable for fast tests. */
const DEFAULT_FLUSH_INTERVAL_MS = 3000;

/**
 * Durable buffer for live Yjs state: exactly one AUTO-kind row per document,
 * upserted in place (never appended), enforced by a partial unique index.
 * This is what survives a server/session restart - it is NOT the
 * user-facing version history (see VersionsService for that).
 */
@Injectable()
export class CollaborationPersistenceService implements OnModuleDestroy {
  private readonly pendingFlushes = new Map<string, NodeJS.Timeout>();
  private readonly flushIntervalMs: number;

  constructor(
    @InjectRepository(DocumentVersion)
    private readonly versions: Repository<DocumentVersion>,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
    private readonly documentsService: DocumentsService,
  ) {
    this.logger.setContext(CollaborationPersistenceService.name);
    const configured = Number(process.env.COLLAB_PERSIST_INTERVAL_MS);
    this.flushIntervalMs =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_FLUSH_INTERVAL_MS;
  }

  onModuleDestroy(): void {
    for (const timer of this.pendingFlushes.values()) {
      clearTimeout(timer);
    }
    this.pendingFlushes.clear();
  }

  /** Loads the durable buffer for a document, or null if none exists yet
   * (brand new document that has never been persisted). */
  async hydrate(documentId: string): Promise<Uint8Array | null> {
    const row = await this.versions.findOne({
      where: { documentId, kind: DocumentVersionKind.AUTO },
    });
    return row ? new Uint8Array(row.state) : null;
  }

  /** Schedules a flush unless one is already pending for this document -
   * trailing throttle, not debounce, so continuous edits still get
   * persisted periodically rather than only once activity stops. */
  scheduleFlush(documentId: string, getState: () => Uint8Array): void {
    if (this.pendingFlushes.has(documentId)) return;
    const timer = setTimeout(() => {
      this.pendingFlushes.delete(documentId);
      void this.flush(documentId, getState());
    }, this.flushIntervalMs);
    timer.unref?.();
    this.pendingFlushes.set(documentId, timer);
  }

  cancelScheduledFlush(documentId: string): void {
    const timer = this.pendingFlushes.get(documentId);
    if (timer) {
      clearTimeout(timer);
      this.pendingFlushes.delete(documentId);
    }
  }

  hasScheduledFlush(documentId: string): boolean {
    return this.pendingFlushes.has(documentId);
  }

  /** Upserts the single AUTO row for this document. Safe to call with a
   * state that has already been persisted before - Yjs updates (and this
   * upsert) are idempotent, so writing the same merged state twice is a
   * no-op in effect, never a duplicate row (enforced by the partial unique
   * index on (documentId) WHERE kind = 'auto'). */
  async flush(documentId: string, state: Uint8Array): Promise<void> {
    try {
      const existing = await this.versions.findOne({
        where: { documentId, kind: DocumentVersionKind.AUTO },
      });
      if (existing) {
        existing.state = Buffer.from(state);
        await this.versions.save(existing);
      } else {
        await this.versions.save(
          this.versions.create({
            documentId,
            kind: DocumentVersionKind.AUTO,
            state: Buffer.from(state),
            createdById: null,
            label: null,
          }),
        );
      }
      this.metrics.collabPersistTotal.inc({ result: 'success' });
    } catch (err) {
      this.metrics.collabPersistTotal.inc({ result: 'error' });
      this.logger.warn(
        {
          event: 'collab_persist_failed',
          documentId,
          error: (err as Error).message,
        },
        'collab_persist_failed',
      );
      return;
    }

    await this.updateSearchIndex(documentId, state);
  }

  /** Stage 8 search: extracts plain text from the state just durably
   * written (never a live in-memory Y.Doc) and keeps
   * `documents.contentText` in sync, at the same trailing-throttle cadence
   * as the durability buffer itself - not per keystroke. A failure here is
   * a secondary side-effect of an already-successful durability write and
   * must never surface as one - logged only, same rationale as
   * RevalidationService/CommentsService.safeEnqueue. */
  private async updateSearchIndex(
    documentId: string,
    state: Uint8Array,
  ): Promise<void> {
    try {
      const blocks = encodeBlocksSnapshot(decodeState(state));
      const contentText = blocks
        .map((b) => b.text)
        .filter((t): t is string => !!t)
        .join(' ');
      await this.documentsService.updateSearchContent(documentId, contentText);
    } catch (err) {
      this.logger.warn(
        {
          event: 'search_index_update_failed',
          documentId,
          error: (err as Error).message,
        },
        'search_index_update_failed',
      );
    }
  }
}
