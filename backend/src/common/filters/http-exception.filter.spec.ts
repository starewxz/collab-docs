import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GlobalExceptionFilter } from './http-exception.filter';
import { AppConfigService } from '../../config/app-config.service';

function createHost(request: Request, response: Response): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;
  let response: Response;
  let request: Request;

  beforeEach(() => {
    const configService = {
      app: { nodeEnv: 'production' },
    } as AppConfigService;
    filter = new GlobalExceptionFilter(configService);

    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    response = { status: statusMock } as unknown as Response;
    request = { id: 'test-correlation-id', url: '/api/example' } as Request;
  });

  it('formats a thrown HttpException into the standard shape', () => {
    const exception = new HttpException('Not allowed', HttpStatus.FORBIDDEN);
    filter.catch(exception, createHost(request, response));

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Not allowed',
        path: '/api/example',
        correlationId: 'test-correlation-id',
      }),
    );
  });

  it('passes Terminus health payloads through unchanged aside from the correlation id', () => {
    const terminusBody = {
      status: 'error',
      info: {},
      error: { redis: { status: 'down' } },
      details: { redis: { status: 'down' } },
    };
    const exception = new HttpException(
      terminusBody,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    filter.catch(exception, createHost(request, response));

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(jsonMock).toHaveBeenCalledWith({
      ...terminusBody,
      correlationId: 'test-correlation-id',
    });
  });

  it('hides internal error messages for unknown errors in production', () => {
    filter.catch(
      new Error('secret db connection string'),
      createHost(request, response),
    );

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Internal server error',
        error: 'Internal Server Error',
      }),
    );
  });
});
