import { serverEnv } from "@/config/env";
import type { BackendStatus } from "@/types/backend";

/**
 * Server-only fetch used to prove frontend -> backend container
 * connectivity. Never call this from a Client Component.
 */
export async function getBackendStatus(): Promise<BackendStatus> {
  try {
    const response = await fetch(
      `${serverEnv.backendInternalUrl}/api/health/live`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      return { reachable: false };
    }

    const body = (await response.json()) as { status?: string };
    return { reachable: true, status: body.status ?? "unknown" };
  } catch {
    return { reachable: false };
  }
}
