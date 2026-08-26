import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.record(request, response, start),
        error: () => this.record(request, response, start),
      }),
    );
  }

  private record(request: Request, response: Response, start: bigint): void {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = this.getRoutePath(request) ?? request.path;
    const labels = {
      method: request.method,
      route,
      status_code: String(response.statusCode),
    };

    this.metrics.httpRequestsTotal.inc(labels);
    this.metrics.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  private getRoutePath(request: Request): string | undefined {
    const route: unknown = request.route;
    if (
      route !== null &&
      typeof route === 'object' &&
      'path' in route &&
      typeof route.path === 'string'
    ) {
      return route.path;
    }
    return undefined;
  }
}
