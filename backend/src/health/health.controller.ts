import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { RedisHealthIndicator } from './indicators/redis.health';
import { MinioHealthIndicator } from './indicators/minio.health';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly typeOrm: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly minio: MinioHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.typeOrm.pingCheck('postgres'),
      () => this.redis.pingCheck('redis'),
      () => this.minio.pingCheck('minio'),
    ]);
  }

  /** Lightweight liveness probe that never touches downstream dependencies. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
