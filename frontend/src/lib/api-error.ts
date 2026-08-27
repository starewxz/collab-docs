export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
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
