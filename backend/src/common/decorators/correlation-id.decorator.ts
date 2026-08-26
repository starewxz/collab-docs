import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { getCorrelationId } from '../correlation-id.util';

export const CorrelationId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return getCorrelationId(request);
  },
);
