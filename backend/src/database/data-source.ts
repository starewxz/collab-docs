import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { ENTITIES } from './entities';

config({ quiet: true });

/**
 * Used by the TypeORM CLI (migration:generate/run/revert) and shares the
 * same connection shape as DatabaseModule. Kept independent from Nest's
 * ConfigModule since the CLI runs outside the Nest application context.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'collab_docs',
  uuidExtension: 'pgcrypto',
  synchronize: false,
  entities: ENTITIES,
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});
