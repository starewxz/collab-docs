/**
 * Wraps an async function so concurrent callers share one in-flight call
 * instead of each triggering their own. Needed for token refresh: several
 * requests can 401 at once, and firing one `/auth/refresh` per 401 races
 * the backend's rotation - the first refresh rotates the token, every
 * other concurrent refresh then presents the now-stale token and trips
 * reuse detection, which revokes the whole session (including the one the
 * first refresh just issued).
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return () => {
    if (!inFlight) {
      inFlight = fn().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
