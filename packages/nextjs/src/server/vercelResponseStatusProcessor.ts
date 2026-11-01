import * as http from "node:http";
import { Context, trace } from "@opentelemetry/api";
import {
  SpanProcessor,
  Span,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { isEntrySpan } from "./entrySpan";

export const HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE = "http.response.status_code";

/**
 * Records the real HTTP response status onto the service-entry span on Vercel.
 *
 * Vercel's bundled Next.js runtime stamps the entry span's status from the
 * response object before the handler's response is written, so the span always
 * reports the default 200 — a 429 or 500 to the client still exports as 200,
 * and warn/error rates flatline. The truth passes through
 * `ServerResponse.prototype.writeHead` when the response is actually written,
 * so this processor tracks live entry spans by trace id and a prototype patch
 * (see `patchServerResponseStatus`) reports the written status back to the
 * entry span of whichever trace is active.
 *
 * The stable `http.response.status_code` key is set deliberately: the bundled
 * runtime writes only the old `http.status_code` key, and the collector only
 * normalizes old → stable when the stable key is absent, so the value recorded
 * here survives regardless of what the runtime writes afterwards.
 */
export class VercelResponseStatusProcessor implements SpanProcessor {
  private readonly entrySpans = new Map<string, Span>();

  onStart(span: Span, _parentContext: Context): void {
    if (!isEntrySpan(span)) return;
    this.entrySpans.set(span.spanContext().traceId, span);
  }

  onEnd(span: ReadableSpan): void {
    if (!isEntrySpan(span)) return;
    this.entrySpans.delete(span.spanContext().traceId);
  }

  /** Called from the ServerResponse patch when a response's head is written. */
  recordStatus(statusCode: number): void {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    if (!traceId) return;
    const entrySpan = this.entrySpans.get(traceId);
    if (entrySpan?.isRecording()) {
      entrySpan.setAttribute(HTTP_RESPONSE_STATUS_CODE_ATTRIBUTE, statusCode);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.entrySpans.clear();
    return Promise.resolve();
  }
}

const PATCHED_FLAG = Symbol.for("vigilon.writeHead.patched");

/**
 * Patches `ServerResponse.prototype.writeHead` to report the written status to
 * the processor. Prototype patching works regardless of when the server was
 * created, which is what makes this viable on Vercel where the runtime's
 * server exists before the SDK starts (the reason HttpInstrumentation never
 * engages there). Node's implicit header write on `res.end()` also goes
 * through `writeHead`, so unwritten-head responses are covered too.
 */
export function patchServerResponseStatus(
  processor: VercelResponseStatusProcessor,
): void {
  const prototype = http.ServerResponse.prototype as typeof http.ServerResponse.prototype & {
    [PATCHED_FLAG]?: boolean;
  };
  if (prototype[PATCHED_FLAG]) return;
  prototype[PATCHED_FLAG] = true;

  const originalWriteHead = prototype.writeHead;
  prototype.writeHead = function patchedWriteHead(
    this: http.ServerResponse,
    ...args: Parameters<typeof originalWriteHead>
  ) {
    const statusCode = typeof args[0] === "number" ? args[0] : this.statusCode;
    try {
      processor.recordStatus(statusCode);
    } catch {
      // Never let telemetry break the response path.
    }
    return originalWriteHead.apply(this, args);
  } as typeof originalWriteHead;
}
