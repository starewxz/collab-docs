import { config } from 'dotenv';
import { join } from 'path';

// e2e tests boot the real AppModule, which connects to Postgres/Redis/MinIO
// on startup - these must already be running (docker compose up, or CI
// service containers). Values here are placeholders and never overwrite
// variables already set in the environment (e.g. by CI).
config({ path: join(__dirname, '.env.test'), quiet: true });
