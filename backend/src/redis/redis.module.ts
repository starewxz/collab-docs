import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Single reusable Redis client for cache/presence use cases. BullMQ keeps
 * its own connections (see QueueModule) since it manages blocking commands
 * internally, but both read connection settings from the same
 * AppConfigService.redis source.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new Redis({
          host: config.redis.host,
          port: config.redis.port,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
