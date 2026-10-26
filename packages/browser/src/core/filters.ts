import type { BrowserEvent } from "./envelope";

export type Pattern = string | RegExp;

/**
 * Noise every application gets and no one can fix: opaque cross-origin
 * errors, failed or aborted network requests, and benign browser warnings.
 * Applications add their own through `ignoreErrors`.
 */
export const DEFAULT_IGNORE_ERRORS: Pattern[] = [
  /^Script error\.?$/,
  /^(TypeError: )?Failed to fetch$/,
  /^(TypeError: )?NetworkError when attempting to fetch resource\.?$/,
  /^(TypeError: )?Load failed$/,
  /^AbortError\b/,
  /The (operation|user) aborted a request/,
  /The operation was aborted/,
  /^ResizeObserver loop/,
];

/** Errors thrown from browser extensions rather than the application. */
export const DEFAULT_DENY_URLS: Pattern[] = [
  /^(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//,
  /^webkit-masked-url:\/\//,
];

const FIRST_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/i;

export function matchesAny(value: string, patterns: Pattern[]): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? value.includes(pattern) : pattern.test(value),
  );
}

export function isIgnoredError(event: BrowserEvent, patterns: Pattern[]): boolean {
  const { type, message } = event.exception;
  return (
    matchesAny(message, patterns) ||
    matchesAny(`${type}: ${message}`, patterns) ||
    (type === "AbortError" && matchesAny("AbortError", patterns))
  );
}

/**
 * The script an error came from: the onerror filename when there is one,
 * else the first URL in the stack, which is the frame where it was thrown.
 */
export function isDeniedUrl(
  event: BrowserEvent,
  sourceUrl: string | undefined,
  patterns: Pattern[],
): boolean {
  const url = sourceUrl || FIRST_URL.exec(event.exception.stack ?? "")?.[0];
  return url !== undefined && matchesAny(url, patterns);
}
