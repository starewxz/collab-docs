import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Later stages register their own metrics here (collab_connections_current,
 * crdt_updates_total, queue_jobs_processed_total, billing_webhooks_total)
 * once there are real events to record. Labels never include userId,
 * workspaceId, or email - only bounded-cardinality values.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDurationSeconds: Histogram<string>;
  readonly authLoginTotal: Counter<string>;
  readonly workspacesCreatedTotal: Counter<string>;
  readonly workspaceInvitationsTotal: Counter<string>;
  readonly documentsCreatedTotal: Counter<string>;
  readonly documentsArchivedTotal: Counter<string>;
  readonly documentOperationsTotal: Counter<string>;
  readonly collabConnectionsCurrent: Gauge<string>;
  readonly collabSessionsCurrent: Gauge<string>;
  readonly crdtUpdatesTotal: Counter<string>;
  readonly collabConnectionErrorsTotal: Counter<string>;
  readonly collabPersistTotal: Counter<string>;
  readonly collabVersionsCreatedTotal: Counter<string>;
  readonly collabVersionRestoreTotal: Counter<string>;
  readonly collabSessionHydratedTotal: Counter<string>;
  readonly collabSessionEvictedTotal: Counter<string>;
  readonly commentsCreatedTotal: Counter<string>;
  readonly commentThreadsResolvedTotal: Counter<string>;
  readonly notificationsProcessedTotal: Counter<string>;
  readonly notificationProcessingFailuresTotal: Counter<string>;
  readonly attachmentUploadsTotal: Counter<string>;
  readonly documentsPublishedTotal: Counter<string>;
  readonly documentsUnpublishedTotal: Counter<string>;
  readonly publicRenderFailuresTotal: Counter<string>;
  readonly publicRevalidationFailuresTotal: Counter<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.authLoginTotal = new Counter({
      name: 'auth_login_total',
      help: 'Total login attempts',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.workspacesCreatedTotal = new Counter({
      name: 'workspaces_created_total',
      help: 'Total workspaces created',
      registers: [this.registry],
    });

    this.workspaceInvitationsTotal = new Counter({
      name: 'workspace_invitations_total',
      help: 'Total workspace invitation lifecycle events',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.documentsCreatedTotal = new Counter({
      name: 'documents_created_total',
      help: 'Total documents created',
      registers: [this.registry],
    });

    this.documentsArchivedTotal = new Counter({
      name: 'documents_archived_total',
      help: 'Total documents archived',
      registers: [this.registry],
    });

    this.documentOperationsTotal = new Counter({
      name: 'document_operations_total',
      help: 'Total document operations by type',
      labelNames: ['operation'],
      registers: [this.registry],
    });

    this.collabConnectionsCurrent = new Gauge({
      name: 'collab_connections_current',
      help: 'Current open collaboration WebSocket connections',
      registers: [this.registry],
    });

    this.collabSessionsCurrent = new Gauge({
      name: 'collab_sessions_current',
      help: 'Current active document collaboration sessions (documents with at least one connected client)',
      registers: [this.registry],
    });

    this.crdtUpdatesTotal = new Counter({
      name: 'crdt_updates_total',
      help: 'Total Yjs CRDT update messages applied and relayed',
      registers: [this.registry],
    });

    this.collabConnectionErrorsTotal = new Counter({
      name: 'collab_connection_errors_total',
      help: 'Total rejected collaboration connections/updates by reason',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.collabPersistTotal = new Counter({
      name: 'collab_persist_total',
      help: 'Total durable-buffer persistence attempts for collaborative documents',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.collabVersionsCreatedTotal = new Counter({
      name: 'collab_versions_created_total',
      help: 'Total explicit document versions created',
      labelNames: ['kind'],
      registers: [this.registry],
    });

    this.collabVersionRestoreTotal = new Counter({
      name: 'collab_version_restore_total',
      help: 'Total document version restores',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.collabSessionHydratedTotal = new Counter({
      name: 'collab_session_hydrated_total',
      help: 'Total collaboration sessions hydrated from durable storage on first join',
      registers: [this.registry],
    });

    this.collabSessionEvictedTotal = new Counter({
      name: 'collab_session_evicted_total',
      help: 'Total in-memory collaboration sessions evicted after their grace period',
      registers: [this.registry],
    });

    this.commentsCreatedTotal = new Counter({
      name: 'comments_created_total',
      help: 'Total comments created',
      labelNames: ['kind'], // 'root' | 'reply'
      registers: [this.registry],
    });

    this.commentThreadsResolvedTotal = new Counter({
      name: 'comment_threads_resolved_total',
      help: 'Total comment thread resolve/reopen actions',
      labelNames: ['action'], // 'resolved' | 'reopened'
      registers: [this.registry],
    });

    this.notificationsProcessedTotal = new Counter({
      name: 'notifications_processed_total',
      help: 'Total notification jobs processed',
      labelNames: ['result'], // 'created' | 'duplicate'
      registers: [this.registry],
    });

    this.notificationProcessingFailuresTotal = new Counter({
      name: 'notification_processing_failures_total',
      help: 'Total notification jobs that failed processing',
      registers: [this.registry],
    });

    this.attachmentUploadsTotal = new Counter({
      name: 'attachment_uploads_total',
      help: 'Total attachment upload lifecycle events',
      labelNames: ['result'], // 'requested' | 'confirmed' | 'rejected'
      registers: [this.registry],
    });

    this.documentsPublishedTotal = new Counter({
      name: 'documents_published_total',
      help: 'Total documents published',
      registers: [this.registry],
    });

    this.documentsUnpublishedTotal = new Counter({
      name: 'documents_unpublished_total',
      help: 'Total documents unpublished (explicit or auto-unpublished on archive)',
      registers: [this.registry],
    });

    this.publicRenderFailuresTotal = new Counter({
      name: 'public_render_failures_total',
      help: 'Total failures rendering a public document (not counting plain not-found)',
      registers: [this.registry],
    });

    this.publicRevalidationFailuresTotal = new Counter({
      name: 'public_revalidation_failures_total',
      help: 'Total failed calls to the frontend on-demand revalidation endpoint',
      registers: [this.registry],
    });
  }

  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
