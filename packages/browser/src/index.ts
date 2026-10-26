/**
 * @vigilon/browser: error monitoring for browser applications.
 *
 * Importing this module has no side effects, and every function is a safe
 * no-op until `init` runs in a browser, so it can be imported during SSR.
 */
import {
  BrowserClient,
  invalidOptions,
  SDK_VERSION,
  type CaptureContext,
  type VigilonBrowserOptions,
} from "./browser/client";

export type { CaptureContext, VigilonBrowserOptions } from "./browser/client";
export type {
  BrowserEvent,
  BrowserException,
  ExceptionCause,
  ExceptionMechanism,
} from "./core/envelope";
export { SDK_VERSION };

let client: BrowserClient | null = null;

/**
 * Starts error monitoring: captures uncaught errors and unhandled promise
 * rejections and sends them to Vigilon. Call it once, as early as possible.
 * Returns false when it did not start (not in a browser, or invalid options).
 */
export function init(options: VigilonBrowserOptions): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  const problem = invalidOptions(options);
  if (problem !== null) {
    console.error(`[Vigilon] not started: ${problem}`);
    return false;
  }
  if (!options.serviceVersion) {
    console.warn(
      "[Vigilon] serviceVersion is not set; errors will not be linked to a release",
    );
  }
  if (client !== null) {
    void client.close(0);
  }
  client = new BrowserClient(options);
  client.install();
  return true;
}

/**
 * Reports an error you caught yourself. Returns the event ID, or null when
 * the error was not sent (not initialised, filtered, sampled out, or dropped
 * by beforeSend).
 */
export function captureException(
  error: unknown,
  context?: CaptureContext,
): string | null {
  return client === null ? null : client.capture(error, context);
}

/** Attaches an opaque user ID to later events. Pass null to clear it. */
export function setUser(user: { id: string } | null): void {
  client?.setUser(user);
}

/** Attaches a tag to later events. */
export function setTag(key: string, value: string): void {
  client?.setTag(key, value);
}

/** Sends queued events now. Resolves true when everything was sent. */
export function flush(timeoutMs?: number): Promise<boolean> {
  return client === null ? Promise.resolve(true) : client.flush(timeoutMs);
}

/** Flushes, then stops capturing errors. */
export async function close(timeoutMs?: number): Promise<boolean> {
  if (client === null) {
    return true;
  }
  const closing = client;
  client = null;
  return closing.close(timeoutMs);
}
