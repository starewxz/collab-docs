import { defineConfig } from "@playwright/test";

/**
 * Browser-level auth/session regression tests - execute the real frontend
 * JS bundle against a running stack, unlike vitest (which only exercises
 * `single-flight.ts` in isolation). Requires `docker compose up -d` (or an
 * equivalent frontend+backend+Postgres+Redis+MinIO stack) already running
 * at these URLs; this config does not start one.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3001",
  },
});
