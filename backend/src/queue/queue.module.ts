import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigService } from '../config/app-config.service';

/**
 * Registers the shared BullMQ Redis connection. Feature modules import
 * BullModule.registerQueue({ name: QueueName.X }) for the queues they own.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: {
          host: config.redis.host,
          port: config.redis.port,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
