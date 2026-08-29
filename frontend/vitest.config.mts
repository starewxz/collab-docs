import { fileURLToPath } from "url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // e2e/ holds Playwright browser specs (run via `npm run test:e2e:browser`
    // against a live stack), not vitest unit tests - excluded so vitest's
    // default *.spec.ts glob doesn't try to run them here too.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
