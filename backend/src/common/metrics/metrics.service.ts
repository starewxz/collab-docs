import { Injectable } from '@nestjs/common';
import {
  Counter,
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
  }

  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
