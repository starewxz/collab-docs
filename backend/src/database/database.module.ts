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
        // Postgres 13+ ships gen_random_uuid() in core; pgcrypto (enabled
        // in the first migration) covers older versions too. Without this,
        // TypeORM defaults uuid primary columns to uuid_generate_v4(),
        // which needs the uuid-ossp extension instead.
        uuidExtension: 'pgcrypto' as const,
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
