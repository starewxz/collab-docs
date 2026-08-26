/**
 * Server-side only: reachable from Server Components, Route Handlers, and
 * Server Actions. Uses the Docker-internal service DNS name and must never
 * be exposed to the browser bundle.
 */
export const serverEnv = {
  backendInternalUrl:
    process.env.BACKEND_INTERNAL_URL ?? "http://localhost:4000",
};

/**
 * Browser-safe values only. Anything read here is inlined into the client
 * bundle at build time, so never put secrets behind NEXT_PUBLIC_*.
 */
export const publicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
};
