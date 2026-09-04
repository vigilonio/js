import { SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Record an exception on the currently active span.
 *
 * Runtime-agnostic: works anywhere there is an active OpenTelemetry span —
 * Express and Fastify route handlers, Lambda invocations, and background jobs
 * (`withJobMonitor`) — because it reads the active span from context rather
 * than the HTTP response object. If there is no active span (called outside
 * any traced scope), it is a no-op.
 */
export function recordException(error: unknown): void {
  const span = trace.getActiveSpan();

  if (!span) {
    return;
  }

  const recorded = toRecordedError(error);
  span.recordException(recorded);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: recorded.message,
  });
}

/** Internal: normalizes any thrown value into an Error for span.recordException(). */
export function toRecordedError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(formatErrorMessage(error));
}

function formatErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
