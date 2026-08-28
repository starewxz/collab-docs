import type { Subscription } from "./types";

/** Every function here takes the caller's `apiFetch` (from useAuth()) so
 * this module stays a plain, testable API layer with no React dependency. */
type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export function getSubscription(
  apiFetch: ApiFetch,
  workspaceId: string,
): Promise<Subscription> {
  return apiFetch<Subscription>(`/api/workspaces/${workspaceId}/billing`);
}

/** Dev-only mock checkout confirmation - stands in for a real provider's
 * asynchronous webhook call (see backend BillingService.mockConfirmPayment). */
export function mockPay(
  apiFetch: ApiFetch,
  workspaceId: string,
): Promise<Subscription> {
  return apiFetch<Subscription>(`/api/workspaces/${workspaceId}/billing/mock-pay`, {
    method: "POST",
  });
}

export function downgradeToFree(
  apiFetch: ApiFetch,
  workspaceId: string,
): Promise<Subscription> {
  return apiFetch<Subscription>(`/api/workspaces/${workspaceId}/billing/downgrade`, {
    method: "POST",
  });
}
