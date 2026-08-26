import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';
import { AppConfigService } from '../../config/app-config.service';
import { CORRELATION_ID_HEADER } from '../constants';

function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const incoming = req.headers[CORRELATION_ID_HEADER];
            const correlationId = isValidCorrelationId(incoming)
              ? incoming
              : randomUUID();
            res.setHeader(CORRELATION_ID_HEADER, correlationId);
            return correlationId;
          },
          customAttributeKeys: {
            reqId: 'correlationId',
            responseTime: 'duration',
          },
          // pino-http only binds the (renamed) reqId key onto the logger
          // when quietReqLogger is set - without it, correlationId never
          // actually appears in the log output.
          quietReqLogger: true,
          // Never serialize headers/body so secrets and tokens can't leak
          // into logs, even by accident.
          serializers: {
            req: (req: { method: string; url: string }) => ({
              method: req.method,
              path: req.url,
            }),
            res: (res: { statusCode: number }) => ({
              statusCode: res.statusCode,
            }),
          },
          level: config.app.nodeEnv === 'production' ? 'info' : 'debug',
          transport:
            config.app.nodeEnv === 'production'
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'HH:MM:ss' },
                },
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggingModule {}
