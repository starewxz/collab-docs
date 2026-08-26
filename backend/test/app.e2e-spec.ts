import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

interface HealthCheckBody {
  status: string;
  info: Record<string, { status: string }>;
}

interface ErrorResponseBody {
  statusCode: number;
  path: string;
  correlationId: string;
  timestamp: string;
}

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live reports process liveness', () => {
    return request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('GET /api/health reports each dependency as up', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as HealthCheckBody;
        expect(body.status).toBe('ok');
        expect(body.info.postgres.status).toBe('up');
        expect(body.info.redis.status).toBe('up');
        expect(body.info.minio.status).toBe('up');
      });
  });

  it('GET /api/unknown-route returns the standardized error shape', () => {
    return request(app.getHttpServer())
      .get('/api/unknown-route')
      .expect(404)
      .expect((res) => {
        const body = res.body as ErrorResponseBody;
        expect(body.statusCode).toBe(404);
        expect(body.path).toBe('/api/unknown-route');
        expect(typeof body.correlationId).toBe('string');
        expect(typeof body.timestamp).toBe('string');
      });
  });
});
