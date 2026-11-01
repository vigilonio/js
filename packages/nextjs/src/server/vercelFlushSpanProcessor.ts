import { Context } from "@opentelemetry/api";
import { SpanProcessor, Span, ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { isEntrySpan } from "./entrySpan";

export type Flushable = { forceFlush(): Promise<void> };

// The request-context global that @vercel/functions uses to reach waitUntil.
// Reading it directly keeps the SDK dependency-free; it is simply absent
// outside Vercel's runtime.
const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

// Backstop so a request that never ends its entry span (crash, client
// disconnect edge cases) cannot pin the instance — and its billing — open
// indefinitely via the keep-alive registered at span start.
const KEEP_ALIVE_TIMEOUT_MS = 15_000;

function vercelWaitUntil(promise: Promise<unknown>): void {
  const requestContext = (
    globalThis as Record<symbol, unknown> as {
      [VERCEL_REQUEST_CONTEXT]?: {
        get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined;
      };
    }
  )[VERCEL_REQUEST_CONTEXT];
  requestContext?.get?.()?.waitUntil?.(promise);
}

/**
 * Exports telemetry at the end of every request instead of trusting timers.
 *
 * Vercel suspends the function instance the moment a response is sent, so the
 * BatchSpanProcessor's export timer rarely gets to run, and even an export
 * started at span end freezes mid-POST: it only completes if another request
 * thaws the instance before the connection dies.
 * Observed in production as "N consecutive requests record N-1", "spaced-out
 * requests record nothing", and stale spans surfacing alongside later
 * traffic.
 *
 * The keep-alive is therefore registered with Vercel's waitUntil when the
 * entry span STARTS — registrations made after the response settles are
 * silently dropped, and the entry span only ends after that point. The
 * deferred handed to waitUntil at start is resolved once the end-of-request
 * flush completes, so the instance stays alive exactly long enough for the
 * export POST to land.
 *
 * Must be registered AFTER the BatchSpanProcessor: processors run in order,
 * and the entry span must already be enqueued when the flush starts.
 */
export class VercelFlushSpanProcessor implements SpanProcessor {
  private readonly keepAlives = new Map<string, () => void>();

  constructor(private readonly flushables: Flushable[]) {}

  onStart(span: Span, _parentContext: Context): void {
    if (!isEntrySpan(span)) return;

    let resolveKeepAlive!: () => void;
    const keepAlive = new Promise<void>((resolve) => {
      resolveKeepAlive = resolve;
    });
    vercelWaitUntil(keepAlive);

    const backstop = setTimeout(resolveKeepAlive, KEEP_ALIVE_TIMEOUT_MS);
    backstop.unref?.();
    this.keepAlives.set(span.spanContext().spanId, () => {
      clearTimeout(backstop);
      resolveKeepAlive();
    });
  }

  onEnd(span: ReadableSpan): void {
    if (!isEntrySpan(span)) return;

    const spanId = span.spanContext().spanId;
    const release = this.keepAlives.get(spanId);
    this.keepAlives.delete(spanId);

    const exportDone = Promise.allSettled(
      this.flushables.map((flushable) => flushable.forceFlush()),
    ).then(() => undefined);
    if (release) void exportDone.finally(release);
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    for (const release of this.keepAlives.values()) release();
    this.keepAlives.clear();
    return Promise.resolve();
  }
}
