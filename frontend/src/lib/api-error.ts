export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
  /** Present when the backend rejected the request for a plan/entitlement
   * reason (EntitlementsService's PlanLimitExceededPayload) rather than an
   * authorization or validation failure - lets callers render an "upgrade
   * to PRO" CTA instead of a generic error. */
  code?: string;
  limitType?: "members" | "documents" | "storage" | string;
  limit?: number;
  current?: number;
  plan?: "free" | "pro";
}

/** Thrown by apiFetch for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined) {
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : (body?.message ?? `Request failed with status ${status}`);
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isPlanLimitError(error: unknown): error is ApiError & {
  body: ApiErrorBody & { code: "PLAN_LIMIT_EXCEEDED" };
} {
  return isApiError(error) && error.body?.code === "PLAN_LIMIT_EXCEEDED";
}

/** A friendlier take on a PLAN_LIMIT_EXCEEDED error than the raw backend
 * message alone (Stage 9) - states the limit, current usage when the
 * backend included it, and a concrete next step, instead of a generic
 * "request failed" style error. */
export function formatPlanLimitMessage(
  error: ApiError & { body: ApiErrorBody & { code: "PLAN_LIMIT_EXCEEDED" } },
  nextStep: string,
): string {
  const { limit, current, plan } = error.body;
  const usage =
    typeof limit === "number" && typeof current === "number"
      ? ` (${current}/${limit} used on the ${(plan ?? "current").toUpperCase()} plan).`
      : "";
  return `${error.message}${usage} ${nextStep}`;
}
