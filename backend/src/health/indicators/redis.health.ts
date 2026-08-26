import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async pingCheck(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.client.ping();
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
