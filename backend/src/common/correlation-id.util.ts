import type { Request } from 'express';

/** `req.id` is typed broadly by pino-http; we always set it to a string. */
export function getCorrelationId(request: Request): string {
  const { id } = request;
  return typeof id === 'string' ? id : '';
}
