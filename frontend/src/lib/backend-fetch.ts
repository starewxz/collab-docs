import { publicEnv } from "@/config/env";
import { ApiError, type ApiErrorBody } from "./api-error";

/**
 * Browser-side fetch wrapper. Always sent with credentials so the
 * httpOnly refresh cookie rides along on auth endpoints - the browser
 * talks directly to the backend, no Next.js proxy in between.
 */
export async function backendFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${publicEnv.apiUrl}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, data as ApiErrorBody | undefined);
  }

  return data as T;
}
