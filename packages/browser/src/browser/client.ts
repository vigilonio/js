import { DebugIdIndex } from "../core/debug-ids";
import type { BrowserEvent, ExceptionMechanism } from "../core/envelope";
import { limitException, toException } from "../core/exception";
import {
  DEFAULT_DENY_URLS,
  DEFAULT_IGNORE_ERRORS,
  isDeniedUrl,
  isIgnoredError,
  type Pattern,
} from "../core/filters";
import { FloodGuard } from "../core/flood";
import { LIMITS, SCHEMA_ID, SERVICE_TOKEN_PATTERN } from "../core/limits";
import {
  sanitizeDebugIds,
  sanitizeIdentifier,
  sanitizeTags,
  sanitizeUserId,
} from "../core/privacy";
import { scrubUrl, truncate } from "../core/text";
import { Transport } from "../core/transport";
import { uuid } from "../core/uuid";
import { sessionId } from "./session";

declare const __VIGILON_SDK_VERSION__: string;

export const SDK_NAME = "@vigilon/browser";
export const SDK_VERSION = __VIGILON_SDK_VERSION__;
const DEFAULT_ENDPOINT = "https://ingest.vigilon.io";
const EVENTS_PATH = "/v1/browser/events";

export interface VigilonBrowserOptions {
  /** A project API key from the Vigilon dashboard. */
  apiKey: string;
  /** The Service this app reports as. Letters, digits, and `._:/-`, up to 100 characters. */
  serviceName: string;
  /** The deployment environment, for example `production`. Same character set. */
  environment: string;
  /** The release, for example a build number or commit SHA. */
  serviceVersion?: string;
  /** The ingest base URL. Defaults to https://ingest.vigilon.io. */
  endpoint?: string;
  /** Extra errors to drop, matched against the message and against `type: message`. */
  ignoreErrors?: Pattern[];
  /** Extra script URLs whose errors are dropped. */
  denyUrls?: Pattern[];
  /**
   * Inspect, edit, or drop (return null) each event before it is sent. The
   * place to scrub free-text messages, which Vigilon cannot scrub for you.
   */
  beforeSend?: (event: BrowserEvent) => BrowserEvent | null;
  /** Fraction of errors to send, from 0 to 1. Defaults to 1. */
  sampleRate?: number;
  /** At most this many events per page load. Defaults to 100. */
  maxEventsPerPage?: number;
  /** Log SDK diagnostics to the console. */
  debug?: boolean;
}

export interface CaptureContext {
  mechanism?: ExceptionMechanism;
  handled?: boolean;
  /** Overrides the route template for this event. */
  route?: string;
  componentStack?: string;
}

const DUPLICATE_WINDOW_MS = 60_000;

export class BrowserClient {
  private readonly transport: Transport;
  private readonly floodGuard: FloodGuard;
  private readonly ignoreErrors: Pattern[];
  private readonly denyUrls: Pattern[];
  private readonly tags: Record<string, string> = {};
  private readonly debugIds = new DebugIdIndex(globalThis as unknown as Record<string, unknown>);
  private userId: string | null = null;
  private readonly removeListeners: Array<() => void> = [];

  constructor(private readonly options: VigilonBrowserOptions) {
    const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.transport = new Transport({
      url: `${endpoint}${EVENTS_PATH}`,
      apiKey: options.apiKey,
      envelope: {
        schema: SCHEMA_ID,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
        service: {
          name: options.serviceName,
          environment: options.environment,
          ...(options.serviceVersion
            ? { version: truncate(options.serviceVersion, LIMITS.serviceVersionLength) }
            : {}),
        },
      },
      fetch: (input, init) => window.fetch(input, init),
      now: () => Date.now(),
      debug: (message) => this.debug(message),
    });
    this.floodGuard = new FloodGuard(
      options.maxEventsPerPage ?? 100,
      DUPLICATE_WINDOW_MS,
    );
    this.ignoreErrors = [...DEFAULT_IGNORE_ERRORS, ...(options.ignoreErrors ?? [])];
    this.denyUrls = [...DEFAULT_DENY_URLS, ...(options.denyUrls ?? [])];
  }

  install(): void {
    this.listen(window, "error", (event) => {
      const { error, message, filename } = event as ErrorEvent;
      // Without an error object (a cross-origin "Script error."), the message
      // is all there is.
      this.capture(error ?? message, { mechanism: "onerror", handled: false }, filename);
    });
    this.listen(window, "unhandledrejection", (event) => {
      this.capture((event as PromiseRejectionEvent).reason, {
        mechanism: "unhandledrejection",
        handled: false,
      });
    });
    // visibilitychange to hidden is the reliable signal (Firefox has dropped
    // keepalive requests started from pagehide on tab close); pagehide covers
    // browsers that skip it.
    this.listen(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.transport.flushOnUnload();
      }
    });
    this.listen(window, "pagehide", () => this.transport.flushOnUnload());
  }

  capture(error: unknown, context: CaptureContext = {}, sourceUrl?: string): string | null {
    try {
      return this.captureUnsafe(error, context, sourceUrl);
    } catch (failure) {
      // Never let error reporting throw into the application.
      this.debug(`capture failed: ${String(failure)}`);
      return null;
    }
  }

  setUser(user: { id: string } | null): void {
    this.userId = user === null ? null : sanitizeUserId(user.id);
    if (user !== null && this.userId === null) {
      this.debug("user.id dropped: it must be an opaque ID of at most 128 characters, not an email address");
    }
  }

  setTag(key: string, value: string): void {
    this.tags[key] = String(value);
  }

  flush(timeoutMs?: number): Promise<boolean> {
    return this.transport.flush(timeoutMs);
  }

  async close(timeoutMs?: number): Promise<boolean> {
    for (const remove of this.removeListeners.splice(0)) {
      remove();
    }
    const flushed = await this.transport.flush(timeoutMs);
    this.transport.close();
    return flushed;
  }

  private captureUnsafe(
    error: unknown,
    context: CaptureContext,
    sourceUrl?: string,
  ): string | null {
    const sampleRate = this.options.sampleRate ?? 1;
    if (sampleRate < 1 && Math.random() >= sampleRate) {
      return null;
    }
    const exception = toException(
      error,
      context.mechanism ?? "manual",
      context.handled ?? true,
    );
    if (context.componentStack) {
      exception.componentStack = context.componentStack;
    }
    const debugIds = this.debugIds.forStacks([
      exception.stack,
      ...(exception.cause ?? []).map((cause) => cause.stack),
    ]);
    const session = sessionId();
    let event: BrowserEvent | null = {
      type: "exception",
      eventId: uuid(),
      timestamp: new Date().toISOString(),
      exception,
      ...(debugIds ? { debugIds } : {}),
      page: {
        url: window.location.href,
        ...(context.route ? { route: context.route } : {}),
      },
      session: session === null ? null : { id: session },
      user: this.userId === null ? null : { id: this.userId },
      traceId: null,
      tags: { ...this.tags },
    };
    if (
      isIgnoredError(event, this.ignoreErrors) ||
      isDeniedUrl(event, sourceUrl, this.denyUrls)
    ) {
      return null;
    }
    if (this.options.beforeSend) {
      try {
        event = this.options.beforeSend(event);
      } catch (failure) {
        // A throwing beforeSend may have been meant to scrub the event, so
        // the event is dropped rather than sent unscrubbed.
        this.debug(`beforeSend threw; event dropped: ${String(failure)}`);
        return null;
      }
      if (event === null) {
        return null;
      }
    }
    const limited = limitEvent(event);
    if (!this.floodGuard.admit(limited, Date.now())) {
      return null;
    }
    this.transport.enqueue(limited);
    return limited.eventId;
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    this.removeListeners.push(() => target.removeEventListener(type, handler));
  }

  private debug(message: string): void {
    if (this.options.debug) {
      console.warn(`[Vigilon] ${message}`);
    }
  }
}

/**
 * Applies the contract's caps and privacy rules last, after beforeSend, so an
 * edited event can never exceed them.
 */
export function limitEvent(event: BrowserEvent): BrowserEvent {
  const limited: BrowserEvent = {
    type: "exception",
    eventId: event.eventId,
    timestamp: event.timestamp,
    exception: limitException(event.exception),
    page: { url: truncate(scrubUrl(String(event.page.url)), LIMITS.pageUrlLength) },
  };
  if (event.exception.componentStack) {
    limited.exception.componentStack = truncate(
      event.exception.componentStack,
      LIMITS.componentStackLength,
    );
  }
  if (event.page.route) {
    limited.page.route = truncate(event.page.route, LIMITS.pageRouteLength);
  }
  const session = sanitizeIdentifier(event.session?.id);
  limited.session = session === null ? null : { id: session };
  const user = sanitizeUserId(event.user?.id);
  limited.user = user === null ? null : { id: user };
  limited.traceId = sanitizeIdentifier(event.traceId);
  limited.tags = sanitizeTags(event.tags ?? {});
  if (event.debugIds) {
    limited.debugIds = sanitizeDebugIds(event.debugIds);
  }
  return limited;
}

/** Returns a reason the options cannot be used, or null when they can. */
export function invalidOptions(options: VigilonBrowserOptions): string | null {
  if (!options || typeof options.apiKey !== "string" || options.apiKey.length === 0) {
    return "apiKey is required";
  }
  for (const [name, value] of [
    ["serviceName", options.serviceName],
    ["environment", options.environment],
  ] as const) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > LIMITS.serviceNameLength ||
      !SERVICE_TOKEN_PATTERN.test(value)
    ) {
      return `${name} must be 1 to 100 characters of letters, digits, and . _ : / -`;
    }
  }
  return null;
}
