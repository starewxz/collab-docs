import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { getCorrelationId } from '../correlation-id.util';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  correlationId: string;
  timestamp: string;
}

/**
 * Catches everything so every error response (validation, thrown
 * HttpExceptions, unexpected crashes) has the same shape. Terminus health
 * payloads are the one exception: they're already a detailed, well-formed
 * body and get passed through untouched aside from the correlation id.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly config: AppConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = getCorrelationId(request);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (this.isTerminusPayload(body)) {
        response.status(status).json({ ...body, correlationId });
        return;
      }

      const { message, error } = this.normalizeBody(body, exception);
      const payload: ErrorResponseBody = {
        statusCode: status,
        message,
        error,
        path: request.url,
        correlationId,
        timestamp: new Date().toISOString(),
      };
      response.status(status).json(payload);
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const payload: ErrorResponseBody = {
      statusCode: status,
      message:
        this.config.app.nodeEnv === 'production'
          ? 'Internal server error'
          : ((exception as Error)?.message ?? 'Internal server error'),
      error: 'Internal Server Error',
      path: request.url,
      correlationId,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(payload);
  }

  private isTerminusPayload(body: unknown): body is Record<string, unknown> {
    return (
      typeof body === 'object' &&
      body !== null &&
      'status' in body &&
      'info' in body &&
      'details' in body
    );
  }

  private normalizeBody(
    body: unknown,
    exception: HttpException,
  ): { message: string | string[]; error: string } {
    if (typeof body === 'string') {
      return { message: body, error: exception.name };
    }
    if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      return {
        message: (obj.message as string | string[]) ?? exception.message,
        error: (obj.error as string) ?? exception.name,
      };
    }
    return { message: exception.message, error: exception.name };
  }
}
