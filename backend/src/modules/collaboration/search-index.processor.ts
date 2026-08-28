import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../common/metrics/metrics.service';
import { QueueName } from '../../queue/queue.constants';
import { DocumentsService } from '../documents/documents.service';
import { CollaborationPersistenceService } from './collaboration-persistence.service';
import { decodeState, encodeBlocksSnapshot } from './yjs-document.util';

export interface SearchIndexJobPayload {
  documentId: string;
}

/**
 * Async counterpart to the Stage 8 search index (see ADR-019 in
 * `08-decisions.md`): a document edit no longer updates
 * `documents.contentText`/`searchVector` inline inside the collaboration
 * flush path - it enqueues this job instead (see
 * `CollaborationPersistenceService.updateSearchIndex`), which does the
 * actual decode + write here, off the hot edit path.
 *
 * Runs in this same NestJS process (the modular-monolith convention -
 * ADR-001), same as `NotificationsProcessor`.
 *
 * Idempotent and duplicate-safe by construction: this always re-reads the
 * *current* durable buffer (never whatever the state was at enqueue time)
 * and does a plain `UPDATE contentText = ...` - processing the same job
 * twice, or two jobs for the same document delivered out of order, both
 * converge on the same result (whatever the durable buffer holds at the
 * time each one happens to run). There is nothing to "duplicate" the way
 * an INSERT could. BullMQ retries (configured on the queue-add call in
 * `CollaborationPersistenceService`) cover transient failures; a thrown
 * error here lets BullMQ retry, matching `NotificationsProcessor`.
 */
@Processor(QueueName.SEARCH_INDEX)
export class SearchIndexProcessor extends WorkerHost {
  constructor(
    private readonly persistence: CollaborationPersistenceService,
    private readonly documentsService: DocumentsService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    super();
    this.logger.setContext(SearchIndexProcessor.name);
  }

  async process(job: Job<SearchIndexJobPayload>): Promise<void> {
    const { documentId } = job.data;
    try {
      const state = await this.persistence.hydrate(documentId);
      // No durable buffer yet (brand new/never-edited document) - nothing
      // to index. Not an error: the next real edit enqueues its own job.
      if (!state) {
        this.metrics.searchIndexJobsTotal.inc({ result: 'skipped' });
        return;
      }

      const blocks = encodeBlocksSnapshot(decodeState(state));
      const contentText = blocks
        .map((b) => b.text)
        .filter((t): t is string => !!t)
        .join(' ');

      await this.documentsService.updateSearchContent(documentId, contentText);
      this.metrics.searchIndexJobsTotal.inc({ result: 'success' });
    } catch (err) {
      this.metrics.searchIndexJobsTotal.inc({ result: 'error' });
      this.logger.warn(
        {
          event: 'search_index_job_failed',
          documentId,
          error: (err as Error).message,
        },
        'search_index_job_failed',
      );
      throw err; // let BullMQ retry
    }
  }
}
