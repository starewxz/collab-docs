import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppConfigService } from '../config/app-config.service';
import { AppConfigModule } from '../config/app-config.module';
import { ENTITIES } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        type: 'postgres' as const,
        host: config.postgres.host,
        port: config.postgres.port,
        username: config.postgres.user,
        password: config.postgres.password,
        database: config.postgres.database,
        synchronize: false,
        autoLoadEntities: false,
        entities: ENTITIES,
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        migrationsRun: false,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
