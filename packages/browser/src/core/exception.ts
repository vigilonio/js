import type { BrowserException, ExceptionCause, ExceptionMechanism } from "./envelope";
import { LIMITS } from "./limits";
import { scrubUrlsInText, truncate, truncateStack } from "./text";

interface ErrorParts {
  type: string;
  message: string;
  stack: string | null;
}

/**
 * Normalises any thrown value into the event's exception. Non-Error values
 * follow @vigilon/node's toRecordedError: a string is the message, anything
 * else is JSON-serialised, falling back to String().
 */
export function toException(
  error: unknown,
  mechanism: ExceptionMechanism,
  handled: boolean,
): BrowserException {
  const parts = toErrorParts(error);
  const exception: BrowserException = { ...parts, mechanism, handled };
  const cause = toCauseChain(error);
  if (cause.length > 0) {
    exception.cause = cause;
  }
  return exception;
}

/** Applies the format's caps and the URL scrub. */
export function limitException(exception: BrowserException): BrowserException {
  const limited: BrowserException = {
    ...exception,
    ...limitParts(exception),
  };
  if (exception.cause) {
    limited.cause = exception.cause
      .slice(0, LIMITS.causeDepth)
      .map((cause) => limitParts(cause) as ExceptionCause);
  }
  return limited;
}

function limitParts(parts: {
  type: string;
  message: string;
  stack?: string | null;
}): ErrorParts {
  return {
    type: truncate(String(parts.type), LIMITS.exceptionTypeLength),
    message: truncate(String(parts.message), LIMITS.exceptionMessageLength),
    stack:
      typeof parts.stack === "string" && parts.stack.length > 0
        ? truncateStack(scrubUrlsInText(parts.stack))
        : null,
  };
}

function toErrorParts(error: unknown): ErrorParts {
  if (isErrorLike(error)) {
    return {
      type: typeof error.name === "string" && error.name ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : "",
      stack: typeof error.stack === "string" ? error.stack : null,
    };
  }
  return { type: "Error", message: formatValue(error), stack: null };
}

function toCauseChain(error: unknown): ExceptionCause[] {
  const chain: ExceptionCause[] = [];
  const seen = new Set<unknown>([error]);
  let cause = isErrorLike(error) ? error.cause : undefined;
  while (cause !== undefined && cause !== null && chain.length < LIMITS.causeDepth) {
    if (seen.has(cause)) {
      break;
    }
    seen.add(cause);
    chain.push(toErrorParts(cause));
    cause = isErrorLike(cause) ? cause.cause : undefined;
  }
  return chain;
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  cause?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return (
    value instanceof Error ||
    (typeof value === "object" &&
      value !== null &&
      typeof (value as ErrorLike).message === "string" &&
      typeof (value as ErrorLike).stack === "string")
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}
