import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config/app-config.service';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Calls the frontend's on-demand ISR revalidation endpoint so a publish /
 * unpublish / republish is reflected immediately, instead of waiting out
 * the public page's time-based revalidation window. This is a secondary
 * side-effect of an already-committed publish state change - a failed call
 * must never surface as a failure of the publish/unpublish request itself
 * (same rationale as CommentsService.safeEnqueue in Stage 6), so failures
 * are logged/metriced, not thrown. See ADR-017 in docs/ai/08-decisions.md.
 */
@Injectable()
export class RevalidationService {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext(RevalidationService.name);
  }

  async revalidateSlug(slug: string): Promise<void> {
    const secret = this.config.app.revalidateSecret;
    if (!secret) return; // not configured (e.g. unit/e2e tests) - no-op

    try {
      const res = await fetch(
        `${this.config.app.frontendInternalUrl}/api/revalidate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, secret }),
        },
      );
      if (!res.ok) {
        throw new Error(`revalidate endpoint returned status ${res.status}`);
      }
    } catch (err) {
      this.metrics.publicRevalidationFailuresTotal.inc();
      this.logger.warn(
        {
          event: 'public_revalidation_failed',
          error: (err as Error).message,
        },
        'public_revalidation_failed',
      );
    }
  }
}
